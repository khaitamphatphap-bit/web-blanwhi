export type PancakeMappedStatus = {
  pancakeStatus?: "pending_confirmation" | "confirmed" | "packing" | "shipping" | "completed" | "cancelled" | "returned";
  status?: "pending" | "paid" | "failed" | "cancelled";
  shippingStatus?: "not_created" | "ready_to_ship" | "shipping" | "delivered" | "returned" | "cancelled" | "unknown";
  release?: boolean;
};

export function availableQuantity(publishQuantity: unknown, pancakeQuantity: unknown) {
  const safe = (value: unknown) => {
    const number = Number(value);
    return Math.max(0, Math.floor(Number.isFinite(number) ? number : 0));
  };
  return Math.min(safe(publishQuantity), safe(pancakeQuantity));
}

export function changePublishQuantity(current: unknown, quantity: unknown, direction: "decrease" | "restore") {
  const safeCurrent = Math.max(0, Math.floor(Number(current) || 0));
  const safeQuantity = Math.max(0, Math.floor(Number(quantity) || 0));
  return direction === "decrease" ? Math.max(0, safeCurrent - safeQuantity) : safeCurrent + safeQuantity;
}

export function mapPancakeStatus(status: string): PancakeMappedStatus {
  const text = status.toLowerCase().replace(/\s+/g, "_");
  if (["0", "17"].includes(text)) return { pancakeStatus: "pending_confirmation", status: "pending", shippingStatus: "not_created" };
  if (["1", "9"].includes(text)) return { pancakeStatus: "confirmed", status: "pending", shippingStatus: "ready_to_ship" };
  if (["8", "12", "13", "20"].includes(text)) return { pancakeStatus: "packing", status: "pending", shippingStatus: "ready_to_ship" };
  if (text === "2") return { pancakeStatus: "shipping", shippingStatus: "shipping" };
  if (["3", "16"].includes(text)) return { pancakeStatus: "completed", status: "paid", shippingStatus: "delivered" };
  if (["4", "5", "11", "15"].includes(text)) return { pancakeStatus: "returned", shippingStatus: "returned", release: true };
  if (["6", "7"].includes(text)) return { pancakeStatus: "cancelled", status: "cancelled", shippingStatus: "cancelled", release: true };
  if (["pending", "new", "unconfirmed", "chờ_xác_nhận"].includes(text)) return { pancakeStatus: "pending_confirmation", status: "pending", shippingStatus: "not_created" };
  if (["confirmed", "đã_xác_nhận"].includes(text)) return { pancakeStatus: "confirmed", status: "pending", shippingStatus: "ready_to_ship" };
  if (["packing", "packed", "đóng_gói"].includes(text)) return { pancakeStatus: "packing", status: "pending", shippingStatus: "ready_to_ship" };
  if (["shipping", "delivering", "đang_giao"].includes(text)) return { pancakeStatus: "shipping", shippingStatus: "shipping" };
  if (["completed", "delivered", "hoàn_thành"].includes(text)) return { pancakeStatus: "completed", status: "paid", shippingStatus: "delivered" };
  if (["cancelled", "canceled", "hủy"].includes(text)) return { pancakeStatus: "cancelled", status: "cancelled", shippingStatus: "cancelled", release: true };
  if (["returned", "return", "hoàn_hàng"].includes(text)) return { pancakeStatus: "returned", shippingStatus: "returned", release: true };
  return { shippingStatus: "unknown" };
}

export function pancakeOrderKey(orderCode: string) {
  return `BLANWHI:${orderCode.trim().toUpperCase()}`;
}

export function buildPancakeOrderPayload(order: {
  code: string;
  customer: { name: string; phone: string; email?: string; address: string; note?: string };
  items: Array<{ name: string; pancakeVariationId?: string; pancakeProductId?: string; pancakeSku?: string; sku?: string; quantity: number; unitPrice: number }>;
  discount: number;
  shipping: number;
  total: number;
  paymentMethod: string;
}, shopId?: string) {
  return {
    ...(shopId ? { shop_id: Number(shopId) || shopId } : {}),
    custom_id: order.code,
    bill_full_name: order.customer.name,
    bill_phone_number: order.customer.phone,
    bill_email: order.customer.email || "",
    shipping_address: {
      address: order.customer.address,
      full_address: order.customer.address,
      full_name: order.customer.name,
      phone_number: order.customer.phone
    },
    note: order.customer.note || "",
    note_print: order.customer.note || "",
    merge_order: false,
    received_at_shop: false,
    is_free_shipping: order.shipping === 0,
    items: order.items.map((item) => ({
      variation_id: item.pancakeVariationId || item.pancakeSku || undefined,
      product_id: item.pancakeProductId || undefined,
      quantity: item.quantity,
      discount_each_product: 0,
      is_bonus_product: false,
      is_discount_percent: false,
      is_wholesale: false,
      one_time_product: false,
      variation_info: {
        id: item.pancakeVariationId || undefined,
        product_id: item.pancakeProductId || undefined,
        display_id: item.pancakeSku || item.sku || undefined,
        name: item.name,
        retail_price: item.unitPrice
      }
    })),
    shipping_fee: order.shipping,
    total_discount: order.discount,
    total_price: order.total,
    cod: order.paymentMethod === "cod" ? order.total : 0,
    cash: 0,
    status: 0
  };
}
