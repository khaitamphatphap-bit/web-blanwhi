import type { ShopOrder } from "@/lib/types";

export function paymentMethodOf(order: Pick<ShopOrder, "paymentMethod">) {
  return String(order.paymentMethod || "").trim().toLowerCase();
}

export function checkoutWasAccepted(order: Pick<ShopOrder, "checkoutCompletedAt" | "checkoutRequestId" | "pancakeOrderId" | "pancakeStatus">) {
  return Boolean(order.checkoutCompletedAt || !order.checkoutRequestId || order.pancakeOrderId || order.pancakeStatus);
}

export function canCreatePancakeOrder(order: ShopOrder) {
  if (order.status === "paid") return true;
  return paymentMethodOf(order) === "cod" && order.status === "pending" && checkoutWasAccepted(order);
}
