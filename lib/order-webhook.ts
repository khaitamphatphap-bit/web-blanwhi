import { updateOrder } from "@/lib/orders";
import { normalizeShippingStatus } from "@/lib/shipping-providers";
import type { OrderStatus, ShopOrder } from "@/lib/types";

export type ExternalOrderPayload = Record<string, unknown>;

function pickString(payload: ExternalOrderPayload, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<unknown>((current, key) => {
      if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
      return undefined;
    }, payload);
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return "";
}

export function externalOrderCode(payload: ExternalOrderPayload) {
  return pickString(payload, [
    "orderCode",
    "order_code",
    "code",
    "data.orderCode",
    "data.order_code",
    "data.code",
    "order.code",
    "order.orderCode",
    "order.order_code"
  ]);
}

export function normalizePaymentStatus(value: unknown): OrderStatus | undefined {
  const text = String(value || "").toLowerCase().trim();
  if (["paid", "success", "completed", "complete", "done", "da_thanh_toan", "đã thanh toán"].includes(text)) return "paid";
  if (["pending", "waiting", "processing", "cho_thanh_toan", "chờ thanh toán"].includes(text)) return "pending";
  if (["failed", "fail", "error", "rejected", "that_bai", "thất bại"].includes(text)) return "failed";
  if (["cancelled", "canceled", "cancel", "huy", "hủy"].includes(text)) return "cancelled";
  return undefined;
}

export async function applyExternalOrderUpdate(
  order: ShopOrder,
  payload: ExternalOrderPayload,
  source: "shipping" | "misa" | "pancake"
) {
  const paymentStatus = normalizePaymentStatus(pickString(payload, [
    "paymentStatus",
    "payment_status",
    "status",
    "data.paymentStatus",
    "data.payment_status",
    "order.paymentStatus",
    "order.status"
  ]));
  const shippingStatus = normalizeShippingStatus(pickString(payload, [
    "shippingStatus",
    "shipping_status",
    "deliveryStatus",
    "delivery_status",
    "state",
    "data.shippingStatus",
    "data.shipping_status",
    "data.status",
    "data.order_status",
    "order.shippingStatus",
    "order.deliveryStatus",
    "order.status"
  ]));
  const trackingCode = pickString(payload, [
    "trackingCode",
    "tracking_code",
    "trackingNumber",
    "label",
    "data.trackingCode",
    "data.tracking_code",
    "data.order_code",
    "data.label_id",
    "order.trackingCode",
    "order.tracking_code"
  ]);
  const carrier = pickString(payload, [
    "carrier",
    "shippingCarrier",
    "shipping_carrier",
    "data.carrier",
    "data.shippingCarrier",
    "order.carrier"
  ]);
  const message = pickString(payload, [
    "message",
    "statusText",
    "status_text",
    "description",
    "data.message",
    "data.status_text",
    "order.statusText"
  ]);

  return updateOrder(order.code, {
    ...(paymentStatus ? { status: paymentStatus } : {}),
    ...(shippingStatus !== "unknown" ? { shippingStatus } : {}),
    ...(trackingCode ? { trackingCode } : {}),
    ...(carrier ? { shippingCarrier: carrier } : {}),
    ...(message ? { shippingMessage: message } : {}),
    externalSync: {
      ...order.externalSync,
      [source]: `${message || shippingStatus || paymentStatus || "Đã nhận cập nhật"} (${new Date().toLocaleString("vi-VN")})`,
      lastSyncedAt: new Date().toISOString()
    }
  });
}
