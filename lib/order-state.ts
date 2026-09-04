import type { OrderItem, ShopOrder } from "./types";

function sameOrderItem(left: OrderItem, right: OrderItem) {
  if (left.inventoryKey && right.inventoryKey) return left.inventoryKey === right.inventoryKey;
  if (left.pancakeVariationId && right.pancakeVariationId) return left.pancakeVariationId === right.pancakeVariationId;
  if (left.sku && right.sku) return left.sku === right.sku;
  return left.productId === right.productId
    && left.color === right.color
    && left.size === right.size;
}

function mergeOrderItems(current: OrderItem[], patch?: OrderItem[]) {
  if (!patch) return current;
  return current.map((original, index) => {
    const next = patch.find((item) => sameOrderItem(original, item)) || patch[index];
    if (!next) return original;
    return {
      ...original,
      sku: next.sku || original.sku,
      inventoryKey: next.inventoryKey || original.inventoryKey,
      pancakeSku: next.pancakeSku || original.pancakeSku,
      pancakeProductId: next.pancakeProductId || original.pancakeProductId,
      pancakeVariationId: next.pancakeVariationId || original.pancakeVariationId
    };
  });
}

export function mergeOrderPatch(current: ShopOrder, patch: Partial<ShopOrder>, updatedAt = new Date().toISOString()) {
  let updated: ShopOrder = {
    ...current,
    ...patch,
    items: mergeOrderItems(current.items, patch.items),
    subtotal: current.subtotal,
    discount: current.discount,
    shipping: current.shipping,
    total: current.total,
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
