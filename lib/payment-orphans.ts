import { readKeyedJsonStore, writeKeyedJsonRecord } from "@/lib/data-store";

export type PaymentOrphan = {
  id: string;
  provider: "zalopay" | "momo" | "vnpay";
  orderCode: string;
  appTransId?: string;
  transactionId?: string;
  amount: number;
  reason: "order_not_found" | "amount_mismatch";
  message: string;
  payload?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const paymentOrphansStore = "payment-orphans";

function paymentOrphanKey(provider: string, orderCode: string, appTransId?: string, transactionId?: string) {
  return [provider, appTransId || transactionId || orderCode].map((value) => String(value || "").trim().toUpperCase()).join(":");
}

export async function readPaymentOrphans() {
  const records = await readKeyedJsonStore<PaymentOrphan>(paymentOrphansStore, {});
  return Object.values(records).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.createdAt).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export async function recordPaymentOrphan(input: Omit<PaymentOrphan, "id" | "createdAt" | "updatedAt">) {
  const now = new Date().toISOString();
  const key = paymentOrphanKey(input.provider, input.orderCode, input.appTransId, input.transactionId);
  const current = (await readKeyedJsonStore<PaymentOrphan>(paymentOrphansStore, {}))[key];
  const record: PaymentOrphan = {
    ...current,
    ...input,
    id: key,
    createdAt: current?.createdAt || now,
    updatedAt: now
  };
  await writeKeyedJsonRecord(paymentOrphansStore, key, record);
  return record;
}
