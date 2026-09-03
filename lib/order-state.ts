import type { ShopOrder } from "./types";

export function mergeOrderPatch(current: ShopOrder, patch: Partial<ShopOrder>, updatedAt = new Date().toISOString()) {
  let updated: ShopOrder = {
    ...current,
    ...patch,
    externalSync: { ...current.externalSync, ...patch.externalSync },
    updatedAt
  };
  if (current.status === "cancelled") {
    updated = {
      ...updated,
      status: "cancelled",
      trackingCode: "",
      shippingStatus: "cancelled",
      pancakeStatus: patch.pancakeStatus === "cancelled" ? "cancelled" : current.pancakeStatus,
      cancellationReason: current.cancellationReason,
      refundStatus: patch.refundStatus ?? current.refundStatus,
      refundMessage: patch.refundMessage ?? current.refundMessage
    };
  }
  return updated;
}

export function carrierHasAcceptedCustomerOrder(order: Pick<ShopOrder, "shippingStatus" | "trackingCode">) {
  const shippingStatus = String(order.shippingStatus || "");
  if (["shipping", "delivered", "returning", "returned"].includes(shippingStatus)) return true;
  return shippingStatus === "ready_to_ship" && Boolean(String(order.trackingCode || "").trim());
}
