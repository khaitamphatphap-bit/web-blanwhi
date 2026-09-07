import type { OrderStatus, ShippingStatus, ShopOrder } from "./types";

export type AdminPaymentStatus =
  | "paid"
  | "pending"
  | "cod_pending"
  | "cod_collected"
  | "failed"
  | "cancelled"
  | "refunded";

export type AdminOrderObservation = {
  orderCode: string;
  canonicalOrder?: ShopOrder;
  paymentStatus?: AdminPaymentStatus;
  paymentSource?: string;
  paymentAmount?: number;
  transactionId?: string;
  paymentProviderOrderId?: string;
  paymentCheckedAt?: string;
  pancakeOrderId?: string;
  pancakeStatus?: ShopOrder["pancakeStatus"];
  trackingCode?: string;
  shippingCarrier?: string;
  shippingStatus?: ShippingStatus;
  deliveryTrackingUrl?: string;
  shippingCheckedAt?: string;
  warning?: string;
  updatedAt: string;
};

export type AdminShopOrder = ShopOrder & {
  adminPaymentStatus: AdminPaymentStatus;
  adminPaymentSource: string;
  adminPaymentAmount: number;
  adminPaymentCheckedAt?: string;
  adminReconciledAt?: string;
  adminShippingStatus: ShippingStatus;
  adminRecoveredFromHistory: boolean;
  adminDataWarning?: string;
  adminNeedsReconciliation: boolean;
};

const shippingProgress: Record<ShippingStatus, number> = {
  unknown: 0,
  not_created: 0,
  awaiting_creation: 1,
  finding_driver: 1,
  driver_assigned: 2,
  ready_to_ship: 2,
  shipping: 3,
  delivery_failed: 3,
  returning: 3,
  delivered: 4,
  returned: 4,
  cancelled: 5
};

function text(value: unknown) {
  return String(value || "").trim();
}

function timestamp(value: unknown) {
  const parsed = new Date(String(value || "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function orderCodeTimestamp(code: string) {
  const match = /^BLW-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(text(code).toUpperCase());
  if (!match) return 0;
  return Date.UTC(
    2000 + Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
}

export function adminOrderLooksRecovered(order: ShopOrder) {
  const codeTime = orderCodeTimestamp(order.code);
  return Boolean(codeTime && Math.abs(timestamp(order.createdAt) - codeTime) >= 12 * 60 * 60 * 1000);
}

function sameOrder(left: ShopOrder, right: ShopOrder) {
  return text(left.code).toUpperCase() === text(right.code).toUpperCase();
}

function sameCustomer(left: ShopOrder, right: ShopOrder) {
  const leftPhone = text(left.customer?.phone).replace(/\D/g, "");
  const rightPhone = text(right.customer?.phone).replace(/\D/g, "");
  return Boolean(leftPhone && leftPhone === rightPhone);
}

function hasVerifiedPaymentEvidence(order: ShopOrder) {
  if (order.status !== "paid") return false;
  if (order.paymentMethod !== "zalopay") return true;
  return Boolean(
    text(order.transactionId)
    || text(order.paymentProviderOrderId || order.providerOrderId)
    || order.paymentVerificationStatus === "verified"
    || /verified|đã thanh toán|thanh toán thành công/i.test(`${order.providerMessage || ""} ${order.externalSync?.payment || ""}`)
  );
}

export function selectAuthoritativeAdminHistory(current: ShopOrder, histories: ShopOrder[]) {
  const candidates = histories.filter((order) => sameOrder(current, order) && order.customer && Array.isArray(order.items) && order.items.length);
  if (!candidates.length) return null;

  const paid = candidates
    .filter(hasVerifiedPaymentEvidence)
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0];
  if (current.paymentMethod === "zalopay" && current.status !== "paid" && paid) return paid;

  const codeTime = orderCodeTimestamp(current.code);
  const currentDistance = codeTime ? Math.abs(timestamp(current.createdAt) - codeTime) : 0;
  if (!adminOrderLooksRecovered(current)) return null;

  return candidates
    .filter((order) => sameCustomer(current, order) || (current.checkoutRequestId && current.checkoutRequestId === order.checkoutRequestId))
    .map((order) => ({ order, distance: Math.abs(timestamp(order.createdAt) - codeTime) }))
    .filter((candidate) => candidate.distance < currentDistance)
    .sort((left, right) => left.distance - right.distance || timestamp(right.order.updatedAt) - timestamp(left.order.updatedAt))[0]?.order || null;
}

function strongestShippingStatus(order: ShopOrder, histories: ShopOrder[], observation?: AdminOrderObservation): ShippingStatus {
  if (order.status === "cancelled" || order.shippingStatus === "cancelled" || order.pancakeStatus === "cancelled") return "cancelled";

  const statuses: ShippingStatus[] = [order.shippingStatus || "not_created"];
  histories.forEach((history) => {
    if (!sameOrder(order, history) || history.status === "cancelled") return;
    statuses.push(history.shippingStatus || "not_created");
    if (history.pancakeStatus === "completed") statuses.push("delivered");
    else if (history.pancakeStatus === "shipping") statuses.push("shipping");
    else if (["confirmed", "packing"].includes(history.pancakeStatus || "")) statuses.push("ready_to_ship");
  });
  if (order.pancakeStatus === "completed") statuses.push("delivered");
  else if (order.pancakeStatus === "shipping") statuses.push("shipping");
  else if (["confirmed", "packing"].includes(order.pancakeStatus || "")) statuses.push("ready_to_ship");
  if (text(order.trackingCode)) statuses.push("shipping");

  if (observation?.shippingStatus && observation.shippingStatus !== "cancelled") statuses.push(observation.shippingStatus);
  if (text(observation?.trackingCode)) statuses.push("shipping");
  return statuses.sort((left, right) => shippingProgress[right] - shippingProgress[left])[0] || "not_created";
}

function paymentStatus(order: ShopOrder, evidence: ShopOrder | null, shippingStatus: ShippingStatus, observation?: AdminOrderObservation): AdminPaymentStatus {
  if (observation?.paymentStatus === "paid" || observation?.paymentStatus === "refunded") return observation.paymentStatus;
  if (order.refundStatus === "succeeded") return "refunded";
  if (order.paymentMethod === "cod") {
    if (order.status === "cancelled") return "cancelled";
    return shippingStatus === "delivered" || order.pancakeStatus === "completed" ? "cod_collected" : "cod_pending";
  }
  if (order.status === "paid" || evidence) return "paid";
  if (order.status === "failed") return "failed";
  if (order.status === "cancelled") return "cancelled";
  return observation?.paymentStatus || "pending";
}

function immutableSnapshot(current: ShopOrder, canonical: ShopOrder | null) {
  if (!canonical) return current;
  return {
    ...current,
    customer: canonical.customer,
    items: canonical.items,
    subtotal: canonical.subtotal,
    discount: canonical.discount,
    shipping: canonical.shipping,
    shippingFeeLabel: canonical.shippingFeeLabel,
    total: canonical.total,
    createdAt: canonical.createdAt,
    checkoutCompletedAt: canonical.checkoutCompletedAt || current.checkoutCompletedAt,
    checkoutRequestId: canonical.checkoutRequestId || current.checkoutRequestId
  };
}

export function buildAdminOrderView(current: ShopOrder, histories: ShopOrder[] = [], observation?: AdminOrderObservation): AdminShopOrder {
  const canonical = observation?.canonicalOrder || selectAuthoritativeAdminHistory(current, histories);
  const base = immutableSnapshot(current, canonical);
  const paidEvidence = [current, canonical, ...histories]
    .filter((order): order is ShopOrder => Boolean(order && sameOrder(current, order)))
    .filter(hasVerifiedPaymentEvidence)
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0] || null;
  const shippingStatus = strongestShippingStatus(base, histories, observation);
  const resolvedPaymentStatus = paymentStatus(base, paidEvidence, shippingStatus, observation);
  const inferredPaymentSource = paidEvidence && paidEvidence !== current
    ? "Lịch sử database đã xác minh"
    : resolvedPaymentStatus === "cod_collected"
      ? "Pancake/ĐVVC đã giao thành công"
      : "Database hiện tại";
  const paymentSource = paidEvidence && paidEvidence !== current
    ? inferredPaymentSource
    : observation?.paymentStatus === resolvedPaymentStatus && observation.paymentSource
      ? observation.paymentSource
      : inferredPaymentSource;
  const trackingCode = text(observation?.trackingCode) || text(base.trackingCode) || text(canonical?.trackingCode);
  const pancakeStatus = observation?.pancakeStatus || base.pancakeStatus || canonical?.pancakeStatus;
  const pancakeOrderId = text(observation?.pancakeOrderId) || text(base.pancakeOrderId) || text(canonical?.pancakeOrderId);
  const transactionId = text(observation?.transactionId) || text(base.transactionId) || text(paidEvidence?.transactionId);
  const paymentProviderOrderId = text(observation?.paymentProviderOrderId)
    || text(base.paymentProviderOrderId || base.providerOrderId)
    || text(paidEvidence?.paymentProviderOrderId || paidEvidence?.providerOrderId);
  const needsPaymentCheck = base.paymentMethod === "zalopay" && resolvedPaymentStatus === "pending";
  const needsShippingCheck = base.status !== "cancelled"
    && shippingStatus !== "delivered"
    && !trackingCode;

  return {
    ...base,
    transactionId: transactionId || undefined,
    paymentProviderOrderId: paymentProviderOrderId || undefined,
    pancakeOrderId: pancakeOrderId || undefined,
    pancakeStatus,
    trackingCode,
    shippingCarrier: observation?.shippingCarrier || base.shippingCarrier || canonical?.shippingCarrier,
    shippingStatus,
    deliveryTrackingUrl: observation?.deliveryTrackingUrl || base.deliveryTrackingUrl || canonical?.deliveryTrackingUrl,
    adminPaymentStatus: resolvedPaymentStatus,
    adminPaymentSource: paymentSource,
    adminPaymentAmount: Math.max(0, Number(observation?.paymentAmount ?? paidEvidence?.total ?? base.total) || 0),
    adminPaymentCheckedAt: observation?.paymentCheckedAt || base.paymentLastCheckedAt,
    adminReconciledAt: observation?.updatedAt,
    adminShippingStatus: shippingStatus,
    adminRecoveredFromHistory: Boolean(canonical),
    adminDataWarning: observation?.warning || (canonical ? "Trang admin đang dùng bản chốt gốc trong lịch sử database vì bản hiện hành từng bị khôi phục sai." : undefined),
    adminNeedsReconciliation: needsPaymentCheck
      || needsShippingCheck
      || (adminOrderLooksRecovered(current) && !observation?.canonicalOrder)
  };
}

export function adminPaymentLabel(order: Pick<AdminShopOrder, "adminPaymentStatus">) {
  const labels: Record<AdminPaymentStatus, string> = {
    paid: "Đã thanh toán",
    pending: "Chờ thanh toán",
    cod_pending: "COD - chưa thu",
    cod_collected: "COD - đã thu",
    failed: "Thanh toán thất bại",
    cancelled: "Đơn đã hủy",
    refunded: "Đã hoàn tiền"
  };
  return labels[order.adminPaymentStatus];
}

export function paginateAdminOrders<T>(orders: T[], page: number, pageSize: number) {
  const safeSize = Math.max(1, Math.floor(pageSize || 1));
  const totalPages = Math.max(1, Math.ceil(orders.length / safeSize));
  const safePage = Math.max(1, Math.min(totalPages, Math.floor(page || 1)));
  return {
    page: safePage,
    pageSize: safeSize,
    totalPages,
    items: orders.slice((safePage - 1) * safeSize, safePage * safeSize)
  };
}

export function adminOrderStatusForLegacy(order: AdminShopOrder): OrderStatus {
  if (order.adminPaymentStatus === "paid" || order.adminPaymentStatus === "cod_collected") return "paid";
  if (order.adminPaymentStatus === "failed") return "failed";
  if (order.adminPaymentStatus === "cancelled") return "cancelled";
  return order.status;
}
