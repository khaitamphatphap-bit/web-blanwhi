type ReservationOrder = {
  paymentMethod?: string;
  status?: string;
  inventoryReservationApplied?: boolean;
  inventoryReservationReleased?: boolean;
  inventoryReservationExpiresAt?: string;
};

export const zaloPayReservationLifetimeMs = 5 * 60 * 1000;

export function zaloPayReservationExpiresAt(now = Date.now()) {
  return new Date(now + zaloPayReservationLifetimeMs).toISOString();
}

export function isExpiredPendingZaloPayReservation(order: ReservationOrder, now = Date.now()) {
  const expiresAt = new Date(order.inventoryReservationExpiresAt || "").getTime();
  return order.paymentMethod === "zalopay"
    && order.status === "pending"
    && order.inventoryReservationApplied === true
    && order.inventoryReservationReleased !== true
    && Number.isFinite(expiresAt)
    && expiresAt <= now;
}
