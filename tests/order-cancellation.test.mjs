import assert from "node:assert/strict";
import test from "node:test";
import { carrierHasAcceptedCustomerOrder, mergeOrderPatch } from "../lib/order-state.ts";

const cancelledOrder = {
  id: "test-order",
  code: "BLW-TEST-CANCEL",
  status: "cancelled",
  paymentMethod: "cod",
  paymentProvider: "cod",
  customer: { name: "Test", phone: "0900000000", address: "Test" },
  items: [],
  subtotal: 0,
  discount: 0,
  shipping: 0,
  total: 0,
  createdAt: "2026-09-03T00:00:00.000Z",
  updatedAt: "2026-09-03T00:00:00.000Z",
  trackingCode: "",
  shippingStatus: "cancelled",
  pancakeStatus: "packing",
  cancellationReason: "Khách yêu cầu hủy đơn"
};

test("phản hồi Pancake cũ không thể khôi phục đơn đã hủy về đóng gói", () => {
  const result = mergeOrderPatch(cancelledOrder, {
    status: "pending",
    shippingStatus: "shipping",
    pancakeStatus: "packing",
    trackingCode: "SPX-OLD"
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.shippingStatus, "cancelled");
  assert.equal(result.pancakeStatus, "packing");
  assert.equal(result.trackingCode, "");
});

test("xác nhận hủy từ Pancake được phép nâng trạng thái POS thành cancelled", () => {
  const result = mergeOrderPatch(cancelledOrder, { pancakeStatus: "cancelled" });
  assert.equal(result.status, "cancelled");
  assert.equal(result.pancakeStatus, "cancelled");
});

test("khách vẫn được hủy khi Pancake mới đóng gói nhưng chưa có mã vận đơn", () => {
  assert.equal(carrierHasAcceptedCustomerOrder({ shippingStatus: "ready_to_ship", trackingCode: "" }), false);
  assert.equal(carrierHasAcceptedCustomerOrder({ shippingStatus: "ready_to_ship", trackingCode: "SPX123" }), true);
  assert.equal(carrierHasAcceptedCustomerOrder({ shippingStatus: "shipping", trackingCode: "" }), true);
});
