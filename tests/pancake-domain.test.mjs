import assert from "node:assert/strict";
import test from "node:test";
import { availableQuantity, buildPancakeOrderPayload, changePublishQuantity, mapPancakeStatus, pancakeOrderKey } from "../lib/pancake/domain.ts";

test("available_quantity lấy giá trị nhỏ hơn giữa publish_quantity và kho Pancake", () => {
  assert.equal(availableQuantity(20, 100), 20);
  assert.equal(availableQuantity(20, 7), 7);
  assert.equal(availableQuantity(0, 100), 0);
});

test("giữ đơn chỉ giảm publish_quantity, không cho âm", () => {
  assert.equal(changePublishQuantity(20, 3, "decrease"), 17);
  assert.equal(changePublishQuantity(2, 5, "decrease"), 0);
  assert.equal(changePublishQuantity(17, 3, "restore"), 20);
});

test("mã chống tạo đơn trùng ổn định theo mã đơn website", () => {
  assert.equal(pancakeOrderKey("blw-123"), "BLANWHI:BLW-123");
  assert.equal(pancakeOrderKey(" BLW-123 "), "BLANWHI:BLW-123");
});

test("payload tạo đơn gửi đủ khách hàng, SKU, số lượng, giá và tổng tiền", () => {
  const payload = buildPancakeOrderPayload({
    code: "BLW-123",
    customer: { name: "Khách", phone: "0900000000", email: "a@example.com", address: "TP.HCM", note: "Gọi trước" },
    items: [{ name: "Áo", pancakeVariationId: "variation-1", pancakeProductId: "product-1", pancakeSku: "AO-DEN-M", quantity: 2, unitPrice: 300000 }],
    discount: 10000,
    shipping: 30000,
    total: 620000,
    paymentMethod: "cod"
  });
  assert.equal(payload.order.partner_order_id, "BLW-123");
  assert.equal(payload.order.external_order_id, "BLANWHI:BLW-123");
  assert.equal(payload.order.items[0].sku, "AO-DEN-M");
  assert.equal(payload.order.items[0].quantity, 2);
  assert.equal(payload.order.total_price, 620000);
});

test("đồng bộ trạng thái hoàn tất, hủy và hoàn hàng", () => {
  assert.deepEqual(mapPancakeStatus("completed"), { pancakeStatus: "completed", status: "paid", shippingStatus: "delivered" });
  assert.deepEqual(mapPancakeStatus("cancelled"), { pancakeStatus: "cancelled", status: "cancelled", shippingStatus: "cancelled", release: true });
  assert.deepEqual(mapPancakeStatus("returned"), { pancakeStatus: "returned", shippingStatus: "returned", release: true });
});
