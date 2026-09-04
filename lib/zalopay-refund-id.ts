import crypto from "crypto";

type RefundOrder = {
  code: string;
  refundTransactionId?: string;
};

function datePrefix(date: Date) {
  return `${String(date.getFullYear()).slice(-2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function buildZaloPayRefundRequestId(order: RefundOrder, appId: string, date = new Date()) {
  const saved = String(order.refundTransactionId || "").trim();
  if (saved) return saved;
  const orderHash = crypto.createHash("sha256").update(order.code).digest("hex").slice(0, 16);
  return `${datePrefix(date)}_${appId}_${orderHash}`;
}
