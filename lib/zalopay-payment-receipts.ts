import {
  hasDatabase,
  readKeyedJsonRecordDatabaseStatus,
  readKeyedJsonStore,
  writeKeyedJsonRecord,
  withDataStoreLock
} from "@/lib/data-store";
import { findOrderByCode } from "@/lib/orders";
import { markVerifiedPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";

export type ZaloPayPaymentReceipt = {
  id: string;
  appTransId: string;
  transactionId: string;
  orderCode: string;
  amount: number;
  status: "received" | "applied" | "orphan" | "amount_mismatch" | "failed";
  attempts: number;
  message?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const receiptStore = "zalopay-payment-receipts";

function receiptKey(appTransId: string, transactionId: string) {
  return `${String(appTransId || "").trim().toUpperCase()}:${String(transactionId || "").trim()}`;
}

async function readReceipt(id: string) {
  if (hasDatabase()) {
    const state = await readKeyedJsonRecordDatabaseStatus<ZaloPayPaymentReceipt>(receiptStore, id);
    if (!state.ok) throw new Error("Không đọc được database biên nhận ZaloPay.");
    return state.record;
  }
  return (await readKeyedJsonStore<ZaloPayPaymentReceipt>(receiptStore, {}))[id] || null;
}

export async function recordVerifiedZaloPayReceipt(input: {
  appTransId: string;
  transactionId: string;
  orderCode: string;
  amount: number;
  payload: Record<string, unknown>;
}) {
  const id = receiptKey(input.appTransId, input.transactionId);
  return withDataStoreLock(`zalopay-receipt:${id}`, async () => {
    const current = await readReceipt(id);
    const now = new Date().toISOString();
    const receipt: ZaloPayPaymentReceipt = {
      ...current,
      ...input,
      id,
      status: current?.status === "applied" ? "applied" : "received",
      attempts: current?.attempts || 0,
      createdAt: current?.createdAt || now,
      updatedAt: now
    };
    await writeKeyedJsonRecord(receiptStore, id, receipt);
    return receipt;
  });
}

export async function updateZaloPayReceipt(id: string, patch: Partial<ZaloPayPaymentReceipt>) {
  return withDataStoreLock(`zalopay-receipt:${id}`, async () => {
    const current = await readReceipt(id);
    if (!current) return null;
    const updated = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    await writeKeyedJsonRecord(receiptStore, id, updated);
    return updated;
  });
}

async function applyReceipt(receipt: ZaloPayPaymentReceipt) {
  const order = await findOrderByCode(receipt.orderCode);
  if (!order) {
    await updateZaloPayReceipt(receipt.id, {
      status: "orphan",
      attempts: receipt.attempts + 1,
      message: "Website chưa tìm thấy đơn tương ứng."
    });
    return "orphan" as const;
  }
  if (Number(order.total) !== Number(receipt.amount)) {
    await updateZaloPayReceipt(receipt.id, {
      status: "amount_mismatch",
      attempts: receipt.attempts + 1,
      message: `Số tiền ZaloPay ${receipt.amount} không khớp đơn ${order.total}.`
    });
    return "amount_mismatch" as const;
  }
  try {
    const paid = await markVerifiedPayment(order.code, {
      transactionId: receipt.transactionId,
      paymentProviderOrderId: receipt.appTransId,
      providerMessage: "ZaloPay verified receipt applied"
    });
    await updateZaloPayReceipt(receipt.id, {
      status: "applied",
      attempts: receipt.attempts + 1,
      message: "Đã cập nhật đơn sang trạng thái đã thanh toán."
    });
    await syncVerifiedOrderToPos(paid);
    return "applied" as const;
  } catch (error) {
    await updateZaloPayReceipt(receipt.id, {
      status: "failed",
      attempts: receipt.attempts + 1,
      message: error instanceof Error ? error.message : "Chưa cập nhật được đơn."
    });
    return "failed" as const;
  }
}

export async function reconcileUnappliedZaloPayReceipts(limit = 25) {
  const records = await readKeyedJsonStore<ZaloPayPaymentReceipt>(receiptStore, {});
  const candidates = Object.values(records)
    .filter((receipt) => receipt.status === "received" || receipt.status === "failed" || receipt.status === "orphan")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(0, Math.max(1, Math.min(100, Math.floor(limit))));
  const summary = { checked: candidates.length, applied: 0, failed: 0 };
  for (const receipt of candidates) {
    const result = await applyReceipt(receipt);
    if (result === "applied") summary.applied += 1;
    else summary.failed += 1;
  }
  return summary;
}
