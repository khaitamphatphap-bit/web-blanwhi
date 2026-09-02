import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { queryZaloPayPayment } from "@/lib/payment";
import type { ShopOrder } from "@/lib/types";

type RefreshOptions = {
  source?: string;
};

const positivePaidTexts = new Set([
  "paid",
  "completed",
  "complete",
  "success",
  "successful",
  "succeeded",
  "done",
  "đã_thanh_toán",
  "da_thanh_toan",
  "thanh_toan_thanh_cong",
  "thành_công",
  "thanh_cong"
]);

const paymentKeys = [
  "payment_status",
  "paymentStatus",
  "payment_state",
  "paymentState",
  "paid_status",
  "paidStatus",
  "financial_status",
  "financialStatus"
];

const paidBooleanKeys = ["is_paid", "isPaid", "paid"];
const prepaidKeys = ["prepaid", "prepaid_amount", "prepaidAmount", "cash", "money_transfer", "moneyTransfer", "paid_amount", "paidAmount"];
const codKeys = ["cod", "cod_amount", "codAmount", "cash_on_delivery", "cashOnDelivery"];

function normalizeText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function numericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^\d.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => boolean, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 6) return false;
  if (!Array.isArray(value) && visit(value as Record<string, unknown>)) return true;
  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return entries.some((item) => walkRecords(item, visit, depth + 1));
}

function hasPaidPaymentText(payload: unknown) {
  return walkRecords(payload, (record) => paymentKeys.some((key) => {
    if (!(key in record)) return false;
    return positivePaidTexts.has(normalizeText(record[key]));
  }));
}

function hasPaidBoolean(payload: unknown) {
  return walkRecords(payload, (record) => paidBooleanKeys.some((key) => record[key] === true || record[key] === 1 || normalizeText(record[key]) === "true"));
}

function hasPrepaidWithoutCod(payload: unknown, orderTotal: number) {
  const expected = Math.max(0, Math.floor(Number(orderTotal) || 0));
  if (!expected) return false;
  return walkRecords(payload, (record) => {
    const prepaid = prepaidKeys.reduce((max, key) => Math.max(max, numericValue(record[key])), 0);
    const cod = codKeys.reduce((max, key) => Math.max(max, numericValue(record[key])), 0);
    return prepaid >= expected && cod === 0;
  });
}

function pancakeConfirmsPrepaid(order: ShopOrder, payload: unknown) {
  if (order.paymentMethod !== "zalopay") return false;
  return hasPaidPaymentText(payload) || hasPaidBoolean(payload) || hasPrepaidWithoutCod(payload, order.total);
}

async function withTimeout<T>(label: string, task: Promise<T>, timeoutMs = 6500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timeout`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function verifyWithZaloPay(order: ShopOrder) {
  const integrations = await readIntegrationConfig();
  const result = await withTimeout("ZaloPay query", queryZaloPayPayment(order, integrations.payment));
  if (Number(result.return_code) !== 1) {
    await PancakeLogger.write("warning", "payment.customer.zalopay", result.sub_return_message || result.return_message || "ZaloPay chưa xác nhận thanh toán.", order.code);
    return order;
  }
  if (!result.zp_trans_id) {
    await PancakeLogger.write("warning", "payment.customer.zalopay", "ZaloPay báo thành công nhưng thiếu mã giao dịch.", order.code);
    return order;
  }
  if (Number(result.amount || 0) !== Number(order.total)) {
    await PancakeLogger.write("error", "payment.customer.zalopay", `ZaloPay báo lệch tiền: ${result.amount || 0}/${order.total}.`, order.code);
    return order;
  }
  return await updateOrder(order.code, {
    status: "paid",
    transactionId: String(result.zp_trans_id),
    paymentProviderOrderId: result.app_trans_id || order.paymentProviderOrderId,
    providerMessage: "ZaloPay verified while customer viewed order",
    externalSync: {
      ...order.externalSync,
      payment: "ZaloPay xác nhận đã thanh toán khi khách xem đơn",
      lastSyncedAt: new Date().toISOString()
    }
  }) || order;
}

async function verifyWithPancakeReadOnly(order: ShopOrder) {
  const pancake = new PancakeService();
  if (!pancake.configured()) return order;
  const found = await withTimeout("Pancake payment lookup", pancake.findOrder(order.code, order.customer.phone));
  if (!found) {
    await PancakeLogger.write("warning", "payment.customer.pancake", "Không tìm thấy đơn trên Pancake để đối chiếu thanh toán.", order.code);
    return order;
  }
  const details = order.pancakeOrderId
    ? await withTimeout("Pancake payment detail", pancake.order(order.pancakeOrderId)).catch(() => found)
    : found;
  const payload = { found, details };
  if (!pancakeConfirmsPrepaid(order, payload)) {
    await PancakeLogger.write("warning", "payment.customer.pancake", "Pancake chưa có trường thanh toán online đủ rõ để đổi website sang đã thanh toán.", order.code);
    return order;
  }
  return await updateOrder(order.code, {
    status: "paid",
    providerMessage: "Pancake read-only confirmed prepaid ZaloPay order while customer viewed order",
    externalSync: {
      ...order.externalSync,
      payment: "Pancake xác nhận đơn ZaloPay đã thanh toán online",
      lastSyncedAt: new Date().toISOString()
    }
  }) || order;
}

export async function refreshCustomerVisiblePaymentStatus(order: ShopOrder, options: RefreshOptions = {}) {
  if (order.paymentMethod !== "zalopay" || order.status !== "pending") return order;
  let current = await verifyWithZaloPay(order).catch(async (error) => {
    await PancakeLogger.write("warning", "payment.customer.zalopay", error instanceof Error ? error.message : "Không kiểm tra được ZaloPay.", order.code);
    return order;
  });
  if (current.status === "paid") return current;
  current = await verifyWithPancakeReadOnly(current).catch(async (error) => {
    await PancakeLogger.write("warning", "payment.customer.pancake", error instanceof Error ? error.message : "Không kiểm tra được Pancake.", current.code);
    return current;
  });
  if (current.status !== "paid") {
    await updateOrder(current.code, {
      externalSync: {
        ...current.externalSync,
        payment: `${options.source || "Khách xem đơn"}: chưa xác nhận được thanh toán ZaloPay`,
        lastSyncedAt: new Date().toISOString()
      }
    });
    return await findOrderByCode(current.code) || current;
  }
  return current;
}

export async function refreshCustomerVisiblePaymentStatuses(orders: ShopOrder[], options: RefreshOptions = {}) {
  const refreshed = await Promise.all(orders.map((order) => refreshCustomerVisiblePaymentStatus(order, options)));
  const byCode = new Map(refreshed.map((order) => [order.code, order]));
  return orders.map((order) => byCode.get(order.code) || order);
}
