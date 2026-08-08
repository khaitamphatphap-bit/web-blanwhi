import assert from "node:assert/strict";
import test from "node:test";
import { availableQuantity, buildPancakeOrderPayload, changePublishQuantity, mapPancakeStatus, pancakeOrderKey } from "../lib/pancake/domain.ts";

test("available_quantity ưu tiên số lượng admin mở bán trên website", () => {
  assert.equal(availableQuantity(20, 100), 20);
  assert.equal(availableQuantity(20, 7), 20);
  assert.equal(availableQuantity(0, 100), 0);
  assert.equal(availableQuantity(undefined, 7), 7);
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
    customer: { name: "Khách", phone: "0900000000", email: "a@example.com", address: "12 Đường A, Phường B, Quận C, TP.HCM", house: "12 Đường A", provinceId: "701", districtId: "70101", wardId: "7010101", note: "Gọi trước" },
    items: [{ name: "Áo", pancakeVariationId: "variation-1", pancakeProductId: "product-1", pancakeSku: "AO-DEN-M", quantity: 2, unitPrice: 300000 }],
    discount: 10000,
    shipping: 30000,
    total: 620000,
    paymentMethod: "cod"
  }, "1546106", { id: 3, name: "VTP", shopPartnerId: 10932 });
  assert.equal(payload.custom_id, "BLW-123");
  assert.equal(payload.items[0].variation_id, "variation-1");
  assert.equal(payload.items[0].variation_info.display_id, "AO-DEN-M");
  assert.equal(payload.items[0].variation_info.retail_price, 300000);
  assert.equal(payload.items[0].quantity, 2);
  assert.equal(payload.total_price, 620000);
  assert.equal(payload.shipping_address.province_id, "701");
  assert.equal(payload.shipping_address.district_id, "70101");
  assert.equal(payload.shipping_address.commune_id, "7010101");
  assert.equal(payload.status, 12);
  assert.equal(payload.partner.partner_id, 3);
  assert.equal(payload.shop_partner_id, 10932);
});

test("payload đơn đã thanh toán online gửi Pancake không thu COD", () => {
  const payload = buildPancakeOrderPayload({
    code: "BLW-PAID-123",
    customer: { name: "Khách đã trả tiền", phone: "0900000001", address: "12 Đường A, TP.HCM" },
    items: [{ name: "Áo", pancakeVariationId: "variation-1", pancakeProductId: "product-1", pancakeSku: "AO-DEN-M", quantity: 1, unitPrice: 300000 }],
    discount: 0,
    shipping: 30000,
    total: 330000,
    paymentMethod: "zalopay"
  }, "1546106", { id: 3, name: "SPX Express", shopPartnerId: 10932 });

  assert.equal(payload.cod, 0);
  assert.equal(payload.partner.cod, 0);
  assert.equal(payload.is_paid, true);
  assert.equal(payload.paid, true);
  assert.equal(payload.payment_status, "paid");
  assert.equal(payload.payment_method, "zalopay");
  assert.equal(payload.cash, 330000);
  assert.equal(payload.prepaid, 330000);
  assert.equal(payload.prepaid_amount, 330000);
  assert.equal(payload.money_transfer, 330000);
  assert.match(payload.note, /Đã thanh toán online ZALOPAY/);
});

test("đồng bộ trạng thái hoàn tất, hủy và hoàn hàng", () => {
  assert.deepEqual(mapPancakeStatus("completed"), { pancakeStatus: "completed", status: "paid", shippingStatus: "delivered" });
  assert.deepEqual(mapPancakeStatus("cancelled"), { pancakeStatus: "cancelled", status: "cancelled", shippingStatus: "cancelled", release: true });
  assert.deepEqual(mapPancakeStatus("returned"), { pancakeStatus: "returned", shippingStatus: "returned", release: true });
  assert.deepEqual(mapPancakeStatus("6"), { pancakeStatus: "cancelled", status: "cancelled", shippingStatus: "cancelled", release: true });
  assert.deepEqual(mapPancakeStatus("2"), { pancakeStatus: "shipping", shippingStatus: "shipping" });
});
