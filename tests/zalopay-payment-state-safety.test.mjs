import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isExpiredPendingZaloPayReservation,
  isLegacyAutoCancelledZaloPayOrder
} from "../lib/zalopay-reservation-policy.ts";

const orders = await readFile(new URL("../lib/orders.ts", import.meta.url), "utf8");
const inventory = await readFile(new URL("../lib/pancake/inventory-service.ts", import.meta.url), "utf8");
const confirmation = await readFile(new URL("../lib/payment-confirmation.ts", import.meta.url), "utf8");
const customerOrders = await readFile(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
const ipn = await readFile(new URL("../app/api/payments/zalopay-ipn/route.ts", import.meta.url), "utf8");
const receiptStore = await readFile(new URL("../lib/zalopay-payment-receipts.ts", import.meta.url), "utf8");
const cron = await readFile(new URL("../app/api/admin/pancake/poll/route.ts", import.meta.url), "utf8");
const orderState = await readFile(new URL("../lib/order-state.ts", import.meta.url), "utf8");
const retryPayment = await readFile(new URL("../app/api/payments/retry/route.ts", import.meta.url), "utf8");
const orderSync = await readFile(new URL("../lib/pancake/order-sync-service.ts", import.meta.url), "utf8");

test("đơn ZaloPay chờ thanh toán không còn tự hủy sau 24 giờ", () => {
  assert.doesNotMatch(orders, /unpaidOrderLifetimeMs/);
  assert.doesNotMatch(orders, /Date\.now\(\)\s*>=\s*paymentDeadline/);
  assert.match(orders, /isLegacyAutoCancelledZaloPayOrder/);
});

test("hết 5 phút chỉ trả tồn kho và vẫn giữ đơn pending", () => {
  const method = inventory.slice(
    inventory.indexOf("async expireZaloPayReservation"),
    inventory.indexOf("async createReservedOrder")
  );
  assert.match(method, /inventoryReservationReleased:\s*true/);
  assert.match(method, /đơn vẫn chờ ZaloPay xác nhận thanh toán/);
  assert.doesNotMatch(method, /status:\s*["']cancelled["']/);
  assert.doesNotMatch(method, /shippingStatus:\s*["']cancelled["']/);
});

test("chỉ đơn do cơ chế hết hạn cũ tạo ra mới được phục hồi", () => {
  const legacy = {
    paymentMethod: "zalopay",
    status: "cancelled",
    cancellationReason: "Hết hạn thanh toán"
  };
  assert.equal(isLegacyAutoCancelledZaloPayOrder(legacy), true);
  assert.equal(isLegacyAutoCancelledZaloPayOrder({ ...legacy, cancellationReason: "Khách yêu cầu hủy đơn" }), false);
  assert.match(confirmation, /!isLegacyAutoCancelledZaloPayOrder\(current\)/);
});

test("IPN hợp lệ được lưu bền vững trước khi cập nhật đơn", () => {
  const receiptIndex = ipn.indexOf("recordVerifiedZaloPayReceipt");
  const paidIndex = ipn.indexOf("markVerifiedPayment(orderCode");
  assert.ok(receiptIndex >= 0 && paidIndex > receiptIndex);
  assert.match(receiptStore, /status:\s*["']received["']/);
  assert.match(receiptStore, /reconcileUnappliedZaloPayReceipts/);
  assert.match(receiptStore, /receipt\.status === "orphan"/);
  assert.match(cron, /reconcileUnappliedZaloPayReceipts\(\)/);
});

test("cron và mọi đường xem đơn của khách đều đối soát lại ZaloPay", () => {
  assert.match(cron, /reconcilePendingZaloPayPayments\(\)/);
  assert.match(customerOrders, /refreshCustomerVisiblePaymentStatuses/);
  assert.match(customerOrders, /Khách xem đơn bằng mã/);
});

test("đơn đã thanh toán không thể bị bản cập nhật cũ kéo lùi về pending hoặc failed", () => {
  assert.match(orderState, /current\.status === "paid" && \(patch\.status === "pending" \|\| patch\.status === "failed"\)/);
  assert.match(orders, /order\.status === "paid" && \(status === "pending" \|\| status === "failed"\)/);
});

test("lượt giữ chỉ được xem là hết hạn khi đúng là pending", () => {
  const expiresAt = "2026-09-06T00:05:00.000Z";
  const order = {
    paymentMethod: "zalopay",
    status: "pending",
    inventoryReservationApplied: true,
    inventoryReservationReleased: false,
    inventoryReservationExpiresAt: expiresAt
  };
  assert.equal(isExpiredPendingZaloPayReservation(order, Date.parse(expiresAt)), true);
  assert.equal(isExpiredPendingZaloPayReservation({ ...order, status: "paid" }, Date.parse(expiresAt)), false);
});

test("khách thanh toán lại đơn pending sẽ giữ lại tồn kho trong 5 phút mới", () => {
  assert.match(retryPayment, /inventory\.reserveOrder\(order\)/);
  assert.match(retryPayment, /inventoryReservationExpiresAt:\s*zaloPayReservationExpiresAt\(\)/);
  assert.match(retryPayment, /inventory\.releaseOrder\(order\)/);
});

test("job hủy cũ không thể hủy Pancake nếu database không còn ghi nhận đơn hủy", () => {
  assert.match(cron, /job\.type === "order\.cancel"[\s\S]*?if \(order\.status !== "cancelled"\) return;[\s\S]*?\.cancel\(order, false\)/);
  assert.match(orderSync, /async cancel\(order:[\s\S]*?persisted\.status !== "cancelled"[\s\S]*?ORDER_CANCELLATION_NOT_COMMITTED/);
});

test("cờ Pancake cancelled cũ không tự biến trạng thái website thành cancelled", () => {
  assert.doesNotMatch(orders, /baseOrder\.pancakeStatus === "cancelled"/);
});
