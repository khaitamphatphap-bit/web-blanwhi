import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders, updateOrder } from "@/lib/orders";
import { queryZaloPayPayment } from "@/lib/payment";
import { markVerifiedPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";
import { InventoryService } from "@/lib/pancake/inventory-service";
import {
  isExpiredPendingZaloPayReservation,
  isLegacyAutoCancelledZaloPayOrder,
  zaloPayReservationExpiresAt,
  zaloPayReservationLifetimeMs
} from "@/lib/zalopay-reservation-policy";

export { zaloPayReservationExpiresAt, zaloPayReservationLifetimeMs };

type ExpiryOptions = {
  limit?: number;
  queryTimeoutMs?: number;
  syncPos?: boolean;
};

function verificationRetryDelay(order: { paymentVerificationAttempts?: number }) {
  const attempts = Math.max(0, Math.floor(Number(order.paymentVerificationAttempts) || 0));
  return Math.min(24 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(attempts, 8)));
}

function verificationIsDue(order: { paymentLastCheckedAt?: string; paymentVerificationAttempts?: number }, now: number) {
  const checkedAt = new Date(order.paymentLastCheckedAt || "").getTime();
  return !Number.isFinite(checkedAt) || checkedAt + verificationRetryDelay(order) <= now;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("ZaloPay query timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function expireStaleZaloPayReservations(now = Date.now(), options: ExpiryOptions = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 25)));
  const queryTimeoutMs = Math.max(1000, Math.min(10000, Math.floor(options.queryTimeoutMs || 5000)));
  const candidates = (await readOrders())
    .filter((order) => isExpiredPendingZaloPayReservation(order, now))
    .slice(0, limit);
  if (!candidates.length) return { checked: 0, paid: 0, released: 0, retained: 0, errors: 0 };

  const config = await readIntegrationConfig();
  const inventory = new InventoryService();
  const summary = { checked: candidates.length, paid: 0, released: 0, retained: 0, errors: 0 };
  await Promise.all(candidates.map(async (order) => {
    try {
      const payment = await withTimeout(queryZaloPayPayment(order, config.payment), queryTimeoutMs);
      if (Number(payment.return_code) === 1 && payment.zp_trans_id && Number(payment.amount || 0) === Number(order.total)) {
        const paid = await markVerifiedPayment(order.code, {
          transactionId: payment.zp_trans_id,
          paymentProviderOrderId: payment.app_trans_id,
          providerMessage: "ZaloPay verified before releasing expired inventory reservation"
        });
        if (options.syncPos === false) void syncVerifiedOrderToPos(paid).catch(() => undefined);
        else await syncVerifiedOrderToPos(paid);
        summary.paid += 1;
        return;
      }
      if (payment.is_processing === true || Number(payment.return_code) === 3) {
        await updateOrder(order.code, {
          paymentLastCheckedAt: new Date(now).toISOString(),
          paymentVerificationAttempts: (order.paymentVerificationAttempts || 0) + 1,
          paymentVerificationStatus: "processing"
        });
        summary.retained += 1;
        return;
      }
      const expired = await inventory.expireZaloPayReservation(order.code, new Date(now));
      if (expired?.inventoryReservationReleased) summary.released += 1;
      else summary.retained += 1;
    } catch (error) {
      // Khi không hỏi được ZaloPay, tiếp tục giữ hàng để không trả nhầm tồn của giao dịch đã thu tiền.
      await updateOrder(order.code, {
        paymentLastCheckedAt: new Date(now).toISOString(),
        paymentVerificationAttempts: (order.paymentVerificationAttempts || 0) + 1,
        paymentVerificationStatus: "unavailable",
        externalSync: {
          ...order.externalSync,
          payment: error instanceof Error ? `Chờ kiểm tra lại ZaloPay: ${error.message}` : "Chờ kiểm tra lại ZaloPay",
          lastSyncedAt: new Date(now).toISOString()
        }
      }).catch(() => undefined);
      summary.errors += 1;
    }
  }));
  return summary;
}

export async function reconcilePendingZaloPayPayments(now = Date.now(), options: ExpiryOptions = {}) {
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit || 25)));
  const queryTimeoutMs = Math.max(1000, Math.min(10000, Math.floor(options.queryTimeoutMs || 5000)));
  const candidates = (await readOrders())
    .filter((order) => order.paymentMethod === "zalopay"
      && (order.status === "pending" || isLegacyAutoCancelledZaloPayOrder(order))
      && verificationIsDue(order, now))
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(0, limit);
  if (!candidates.length) return { checked: 0, paid: 0, pending: 0, errors: 0 };

  const config = await readIntegrationConfig();
  const summary = { checked: candidates.length, paid: 0, pending: 0, errors: 0 };
  await Promise.all(candidates.map(async (order) => {
    const checkedAt = new Date(now).toISOString();
    const attempts = (order.paymentVerificationAttempts || 0) + 1;
    try {
      const payment = await withTimeout(queryZaloPayPayment(order, config.payment), queryTimeoutMs);
      if (Number(payment.return_code) === 1 && payment.zp_trans_id && Number(payment.amount || 0) === Number(order.total)) {
        const paid = await markVerifiedPayment(order.code, {
          transactionId: payment.zp_trans_id,
          paymentProviderOrderId: payment.app_trans_id,
          providerMessage: "ZaloPay verified by background reconciliation"
        });
        const verified = await updateOrder(paid.code, {
          paymentLastCheckedAt: checkedAt,
          paymentVerificationAttempts: attempts,
          paymentVerificationStatus: "verified"
        }) || paid;
        if (options.syncPos === false) void syncVerifiedOrderToPos(verified).catch(() => undefined);
        else await syncVerifiedOrderToPos(verified);
        summary.paid += 1;
        return;
      }
      await updateOrder(order.code, {
        paymentLastCheckedAt: checkedAt,
        paymentVerificationAttempts: attempts,
        paymentVerificationStatus: payment.is_processing === true || Number(payment.return_code) === 3 ? "processing" : "not_paid"
      });
      summary.pending += 1;
    } catch (error) {
      await updateOrder(order.code, {
        paymentLastCheckedAt: checkedAt,
        paymentVerificationAttempts: attempts,
        paymentVerificationStatus: "unavailable",
        externalSync: {
          ...order.externalSync,
          payment: error instanceof Error ? `Chờ kiểm tra lại ZaloPay: ${error.message}` : "Chờ kiểm tra lại ZaloPay",
          lastSyncedAt: checkedAt
        }
      }).catch(() => undefined);
      summary.errors += 1;
    }
  }));
  return summary;
}
