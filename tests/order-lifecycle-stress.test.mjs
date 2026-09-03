import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPancakeOrderPayload,
  changePublishQuantity,
  mapPancakeStatus,
  pancakeOrderKey
} from "../lib/pancake/domain.ts";

function seededRandom(seed = 260904) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("300 vòng đặt và hủy giữ nguyên tồn kho, mã đơn và trạng thái Pancake", async () => {
  const random = seededRandom();
  const variants = Array.from({ length: 24 }, (_, index) => ({
    id: `variant-${index + 1}`,
    productId: `product-${Math.floor(index / 4) + 1}`,
    sku: `TEST-SKU-${String(index + 1).padStart(2, "0")}`,
    stock: 500
  }));
  const initialStock = new Map(variants.map((variant) => [variant.id, variant.stock]));
  const database = new Map();
  const pancake = new Map();

  for (let batchStart = 1; batchStart <= 300; batchStart += 10) {
    const batch = Array.from({ length: 10 }, (_, batchIndex) => batchStart + batchIndex);
    await Promise.all(batch.map(async (number) => {
      const code = `BLW-STRESS-${String(number).padStart(3, "0")}`;
      const checkoutRequestId = `stress-checkout-${String(number).padStart(3, "0")}`;
      const lineCount = 1 + Math.floor(random() * 4);
      const selected = new Map();

      for (let line = 0; line < lineCount; line += 1) {
        const variant = variants[Math.floor(random() * variants.length)];
        selected.set(variant.id, (selected.get(variant.id) || 0) + 1 + Math.floor(random() * 3));
      }

      const items = Array.from(selected, ([variantId, quantity]) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        assert.ok(variant);
        assert.ok(variant.stock >= quantity, `${variant.sku} phải còn đủ tồn kho`);
        variant.stock = changePublishQuantity(variant.stock, quantity, "decrease");
        return {
          name: variant.sku,
          pancakeVariationId: variant.id,
          pancakeProductId: variant.productId,
          pancakeSku: variant.sku,
          quantity,
          unitPrice: 255000
        };
      });

      assert.equal(database.has(code), false, `không được ghi đè ${code}`);
      const order = {
        code,
        checkoutRequestId,
        status: "pending",
        customer: {
          name: `TEST ${String(number).padStart(3, "0")}`,
          phone: `0977${String(number).padStart(6, "0")}`,
          address: "Địa chỉ kiểm thử cô lập"
        },
        items,
        discount: 0,
        shipping: 30000,
        total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 30000),
        paymentMethod: "cod",
        inventoryReservationApplied: true,
        inventoryReservationReleased: false
      };
      database.set(code, order);

      const duplicate = database.get(code);
      assert.strictEqual(duplicate, order, "cùng mã yêu cầu phải trả lại đúng đơn đã lưu");
      assert.equal(pancake.has(pancakeOrderKey(code)), false, "không được tạo trùng đơn Pancake");
      const payload = buildPancakeOrderPayload(order, "test-shop", undefined, { id: "facebook", name: "facebook" });
      pancake.set(pancakeOrderKey(code), payload);
      assert.equal(payload.items.length, items.length);
      assert.equal(payload.cod, order.total);
      assert.equal(payload.payment_status, "unpaid");

      const cancelled = mapPancakeStatus("cancelled");
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.release, true);
      order.status = "cancelled";
      order.inventoryReservationReleased = true;
      for (const item of items) {
        const variant = variants.find((candidate) => candidate.id === item.pancakeVariationId);
        assert.ok(variant);
        variant.stock = changePublishQuantity(variant.stock, item.quantity, "restore");
      }
      pancake.set(pancakeOrderKey(code), { ...payload, status: "cancelled" });
    }));
  }

  assert.equal(database.size, 300, "database test phải có đủ 300 mã đơn riêng biệt");
  assert.equal(pancake.size, 300, "Pancake test phải có đủ 300 mã chống trùng");
  for (const variant of variants) {
    assert.equal(variant.stock, initialStock.get(variant.id), `${variant.sku} phải được hoàn đúng tồn ban đầu`);
  }
  for (const order of database.values()) {
    assert.equal(order.status, "cancelled");
    assert.equal(order.inventoryReservationApplied, true);
    assert.equal(order.inventoryReservationReleased, true);
  }
});
