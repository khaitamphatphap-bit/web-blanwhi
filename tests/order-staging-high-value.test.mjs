import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildPancakeOrderPayload,
  changePublishQuantity,
  pancakeOrderKey
} from "../lib/pancake/domain.ts";
import { mergeOrderPatch } from "../lib/order-state.ts";

function seededRandom(seed = 1500000) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function clone(value) {
  return structuredClone(value);
}

test("staging cô lập: 1000 đơn tuần tự từ 1,5 triệu giữ đúng dữ liệu và tồn kho", async () => {
  const startedAt = performance.now();
  const random = seededRandom();
  const stagingDirectory = await mkdtemp(join(tmpdir(), "blanwhi-staging-orders-"));
  const auditFile = join(stagingDirectory, "orders.jsonl");
  const database = new Map();
  const checkoutIndex = new Map();
  const deviceIndex = new Map();
  const phoneIndex = new Map();
  const pancake = new Map();
  const variants = Array.from({ length: 32 }, (_, index) => ({
    id: `variant-${index + 1}`,
    productId: `product-${Math.floor(index / 4) + 1}`,
    sku: `STAGING-SKU-${String(index + 1).padStart(2, "0")}`,
    name: `Sản phẩm staging ${Math.floor(index / 4) + 1}`,
    unitPrice: 320000 + (index % 8) * 45000,
    stock: 50
  }));
  const initialStock = new Map(variants.map((variant) => [variant.id, variant.stock]));

  const persist = async (event, order) => {
    await appendFile(auditFile, `${JSON.stringify({ event, order })}\n`, "utf8");
  };

  try {
    for (let number = 1; number <= 1000; number += 1) {
      const operationStartedAt = performance.now();
      const suffix = String(number).padStart(4, "0");
      const code = `BLW-STAGING-HIGH-${suffix}`;
      const checkoutRequestId = `staging-high-checkout-${suffix}`;
      const deviceId = `staging-device-${1 + (number % 25)}`;
      const phone = `0988${String(number).padStart(6, "0")}`;
      const beforeStock = new Map(variants.map((variant) => [variant.id, variant.stock]));
      const selected = new Map();

      while (Array.from(selected, ([variantId, quantity]) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        return variant.unitPrice * quantity;
      }).reduce((sum, value) => sum + value, 30000) < 1500000) {
        const variant = variants[Math.floor(random() * variants.length)];
        selected.set(variant.id, (selected.get(variant.id) || 0) + 1 + Math.floor(random() * 2));
      }

      const requestedItems = Array.from(selected, ([variantId, quantity]) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        assert.ok(variant);
        return { variant, quantity };
      });
      for (const { variant, quantity } of requestedItems) {
        assert.ok(variant.stock >= quantity, `${variant.sku} phải còn đủ tồn staging`);
      }

      const items = requestedItems.map(({ variant, quantity }) => {
        variant.stock = changePublishQuantity(variant.stock, quantity, "decrease");
        return {
          productId: variant.productId,
          name: variant.name,
          color: `Màu ${(number % 5) + 1}`,
          size: ["S", "M", "L", "XL"][number % 4],
          sku: variant.sku,
          inventoryKey: variant.id,
          pancakeVariationId: variant.id,
          pancakeProductId: variant.productId,
          pancakeSku: variant.sku,
          quantity,
          unitPrice: variant.unitPrice
        };
      });
      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const order = {
        id: code,
        code,
        checkoutRequestId,
        status: "pending",
        customer: {
          name: `STAGING HIGH VALUE ${suffix}`,
          phone,
          address: `${number} Đường kiểm thử, Phường staging, TP.HCM`,
          note: `Đơn staging tuần tự số ${number}`
        },
        items,
        subtotal,
        discount: 0,
        shipping: 30000,
        total: subtotal + 30000,
        paymentMethod: "cod",
        shippingStatus: "not_created",
        pancakeStatus: "pending_confirmation",
        inventoryReservationApplied: true,
        inventoryReservationReleased: false,
        createdAt: new Date(1700000000000 + number * 1000).toISOString(),
        updatedAt: new Date(1700000000000 + number * 1000).toISOString()
      };
      assert.ok(order.total >= 1500000, `${code} phải có giá trị từ 1.500.000đ`);
      assert.equal(database.has(code), false, `${code} không được ghi đè đơn khác`);
      assert.equal(checkoutIndex.has(checkoutRequestId), false, `${checkoutRequestId} phải là duy nhất`);

      database.set(code, clone(order));
      checkoutIndex.set(checkoutRequestId, code);
      deviceIndex.set(deviceId, [...(deviceIndex.get(deviceId) || []), code]);
      phoneIndex.set(phone, [...(phoneIndex.get(phone) || []), code]);
      await persist("created", order);

      assert.equal(checkoutIndex.get(checkoutRequestId), code, "retry checkout phải trả đúng đơn cũ");
      assert.equal(deviceIndex.get(deviceId).includes(code), true, "thiết bị đặt phải thấy đơn");
      assert.equal(phoneIndex.get(phone).includes(code), true, "tra cứu số điện thoại phải thấy đơn");
      for (const variant of variants) {
        const purchased = selected.get(variant.id) || 0;
        assert.equal(variant.stock, beforeStock.get(variant.id) - purchased, `${variant.sku} phải trừ đúng biến thể`);
      }

      const payload = buildPancakeOrderPayload(order, "staging-shop", undefined, { id: "facebook", name: "facebook" });
      const pancakeKey = pancakeOrderKey(code);
      assert.equal(pancake.has(pancakeKey), false, "Pancake staging không được nhận trùng đơn");
      pancake.set(pancakeKey, { ...payload, status: "created" });
      assert.equal(payload.items.length, items.length);
      assert.equal(payload.total_price, order.total);
      assert.equal(payload.cod, order.total);

      const saved = database.get(code);
      const changedCatalogItems = saved.items.map((item) => ({
        ...item,
        unitPrice: item.unitPrice + 500000,
        pancakeVariationId: `${item.pancakeVariationId}-linked`
      }));
      const patched = mergeOrderPatch(saved, {
        items: changedCatalogItems,
        subtotal: saved.subtotal + 500000,
        total: saved.total + 500000,
        pancakeStatus: "packing"
      }, new Date(1700000000000 + number * 1000 + 1).toISOString());
      assert.deepEqual(patched.items.map((item) => item.unitPrice), saved.items.map((item) => item.unitPrice), "giá đã chốt không được đổi");
      assert.equal(patched.subtotal, saved.subtotal);
      assert.equal(patched.total, saved.total);
      assert.equal(patched.pancakeStatus, "packing");
      database.set(code, clone(patched));

      const current = database.get(code);
      const cancelled = mergeOrderPatch(current, {
        status: "cancelled",
        shippingStatus: "cancelled",
        pancakeStatus: "cancelled",
        inventoryReservationReleased: true,
        cancellationReason: "Khách hủy trên staging"
      }, new Date(1700000000000 + number * 1000 + 2).toISOString());
      if (!current.inventoryReservationReleased) {
        for (const item of current.items) {
          const variant = variants.find((candidate) => candidate.id === item.inventoryKey);
          assert.ok(variant);
          variant.stock = changePublishQuantity(variant.stock, item.quantity, "restore");
        }
      }
      database.set(code, clone(cancelled));
      pancake.set(pancakeKey, { ...pancake.get(pancakeKey), status: "cancelled" });
      await persist("cancelled", cancelled);

      const cancelRetry = database.get(code);
      assert.equal(cancelRetry.inventoryReservationReleased, true, "retry hủy không được hoàn kho lần hai");
      assert.equal(cancelRetry.status, "cancelled", "đơn phải hủy thật trong database staging");
      assert.equal(cancelRetry.shippingStatus, "cancelled");
      assert.equal(pancake.get(pancakeKey).status, "cancelled", "Pancake staging phải nhận trạng thái hủy");
      for (const variant of variants) {
        assert.equal(variant.stock, beforeStock.get(variant.id), `${variant.sku} phải về đúng tồn trước đơn`);
      }
      assert.ok(performance.now() - operationStartedAt < 1000, `${code} không được treo quá 1 giây trong staging`);
    }

    const auditContent = await readFile(auditFile, "utf8");
    const auditRows = auditContent.trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(database.size, 1000, "database staging phải giữ đủ 1000 đơn");
    assert.equal(checkoutIndex.size, 1000, "không được mất hoặc ghi đè checkout");
    assert.equal(phoneIndex.size, 1000, "mọi số điện thoại test phải tra cứu được");
    assert.equal(pancake.size, 1000, "Pancake staging phải nhận đủ 1000 đơn");
    assert.equal(auditRows.length, 2000, "mỗi đơn phải có đủ lịch sử tạo và hủy");
    assert.equal(new Set(auditRows.filter((row) => row.event === "created").map((row) => row.order.code)).size, 1000);
    for (const order of database.values()) assert.equal(order.status, "cancelled");
    for (const record of pancake.values()) assert.equal(record.status, "cancelled");
    for (const variant of variants) assert.equal(variant.stock, initialStock.get(variant.id));

    const databaseBytes = Buffer.byteLength(JSON.stringify(Array.from(database.values())), "utf8");
    const auditBytes = Buffer.byteLength(auditContent, "utf8");
    assert.ok(databaseBytes < 50 * 1024 * 1024, "1000 đơn không được tạo dữ liệu bất thường trên 50 MB");
    console.log("STAGING_METRICS", JSON.stringify({
      orders: database.size,
      minimumOrderValue: Math.min(...Array.from(database.values(), (order) => order.total)),
      databaseBytes,
      auditBytes,
      estimatedDatabaseBytesFor10000Orders: databaseBytes * 10,
      durationMs: Math.round(performance.now() - startedAt)
    }));
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
});
