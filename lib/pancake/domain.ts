import { shortOrderCode } from "../order-code.ts";

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
  const hasWebsiteQuantity = publishQuantity !== undefined && publishQuantity !== null && String(publishQuantity).trim() !== "";
  return hasWebsiteQuantity ? safe(publishQuantity) : safe(pancakeQuantity);
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
  return `BLANWHI:${shortOrderCode(orderCode)}`;
}

function normalizedPaymentMethod(value: string) {
  return String(value || "").trim().toLowerCase();
}

function isCashOnDeliveryOrder(order: { paymentMethod: string }) {
  return normalizedPaymentMethod(order.paymentMethod) === "cod";
}

export function buildPancakeOrderPayload(order: {
  code: string;
  customer: { name: string; phone: string; email?: string; address: string; house?: string; ward?: string; wardId?: string; district?: string; districtId?: string; province?: string; provinceId?: string; note?: string };
  items: Array<{ name: string; pancakeVariationId?: string; pancakeProductId?: string; pancakeSku?: string; sku?: string; quantity: number; unitPrice: number }>;
  discount: number;
  shipping: number;
  total: number;
  paymentMethod: string;
}, shopId?: string, shippingPartner?: { id: number; name: string; shopPartnerId?: number }) {
  const cashOnDelivery = isCashOnDeliveryOrder(order);
  const cod = cashOnDelivery ? order.total : 0;
  const prepaidAmount = cashOnDelivery ? 0 : order.total;
  const paymentLabel = cashOnDelivery
    ? "COD - thu tiền khi giao hàng"
    : `Đã thanh toán online ${normalizedPaymentMethod(order.paymentMethod).toUpperCase()}`;
  const customerNote = order.customer.note || "";
  return {
    ...(shopId ? { shop_id: Number(shopId) || shopId } : {}),
    custom_id: shortOrderCode(order.code),
    bill_full_name: order.customer.name,
    bill_phone_number: order.customer.phone,
    bill_email: order.customer.email || "",
    shipping_address: {
      address: order.customer.house || order.customer.address,
      full_address: order.customer.address,
      full_name: order.customer.name,
      phone_number: order.customer.phone,
      ...(order.customer.provinceId ? { province_id: order.customer.provinceId } : {}),
      ...(order.customer.districtId ? { district_id: order.customer.districtId } : {}),
      ...(order.customer.wardId ? { commune_id: order.customer.wardId } : {}),
      ...(order.customer.ward ? { commune_name: order.customer.ward, ward_name: order.customer.ward } : {}),
      ...(order.customer.district ? { district_name: order.customer.district } : {}),
      ...(order.customer.province ? { province_name: order.customer.province } : {})
    },
    note: [customerNote, paymentLabel].filter(Boolean).join(" · "),
    note_print: [customerNote, paymentLabel].filter(Boolean).join(" · "),
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
    cod,
    cash: prepaidAmount,
    is_paid: !cashOnDelivery,
    paid: !cashOnDelivery,
    payment_status: cashOnDelivery ? "unpaid" : "paid",
    payment_method: normalizedPaymentMethod(order.paymentMethod),
    prepaid: prepaidAmount,
    prepaid_amount: prepaidAmount,
    money_transfer: prepaidAmount,
    status: 12,
    ...(shippingPartner ? {
      shop_partner_id: shippingPartner.shopPartnerId,
      partner: {
        partner_id: shippingPartner.id,
        partner_name: shippingPartner.name,
        cod,
        cash: prepaidAmount,
        prepaid: prepaidAmount,
        prepaid_amount: prepaidAmount,
        total_fee: order.shipping
      }
    } : {})
  };
}
