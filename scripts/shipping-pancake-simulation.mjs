import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { buildPancakeOrderPayload, changePublishQuantity, pancakeOrderKey } from "../lib/pancake/domain.ts";
import { calculateStandardShipping } from "../lib/shipping-pricing.ts";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function integer(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function remotePancakeTotal(payload) {
  const itemTotal = payload.items.reduce(
    (sum, item) => sum + Number(item.quantity) * Number(item.variation_info.retail_price),
    0
  );
  return Math.max(0, itemTotal + Number(payload.shipping_fee) - Number(payload.total_discount));
}

export function runShippingPancakeBatch({ batchNumber = 1, orderCount = 2000, groupSize = 10 } = {}) {
  const random = seededRandom(260907 + batchNumber * 7919);
  const fees = [0, 1000, 11000, 13000, 15000, 30000, 50000, 99000];
  const thresholds = [50000, 100000, 300000, 499000, 750000, 1000000, 2000000, 5000000];
  const variants = Array.from({ length: 48 }, (_, index) => ({
    id: `shipping-variant-${index + 1}`,
    productId: `shipping-product-${Math.floor(index / 4) + 1}`,
    sku: `SHIP-SKU-${String(index + 1).padStart(2, "0")}`,
    stock: 1_000_000
  }));
  const initialStock = new Map(variants.map((variant) => [variant.id, variant.stock]));
  const database = new Map();
  const pancake = new Map();
  let freeShippingOrders = 0;
  let paidShippingOrders = 0;
  let productDiscountOrders = 0;

  for (let groupStart = 0; groupStart < orderCount; groupStart += groupSize) {
    const groupOrders = [];
    const groupEnd = Math.min(orderCount, groupStart + groupSize);

    for (let index = groupStart; index < groupEnd; index += 1) {
      const sequence = batchNumber * 1_000_000 + index + 1;
      const code = `BLW-SHIP-${String(sequence).padStart(9, "0")}`;
      const defaultFee = fees[(index + batchNumber) % fees.length];
      const freeShippingThreshold = thresholds[(Math.floor(index / fees.length) + batchNumber) % thresholds.length];
      const freeShippingEnabled = (index + batchNumber) % 4 !== 0;
      const lineCount = integer(random, 1, 5);
      const selected = new Map();

      for (let line = 0; line < lineCount; line += 1) {
        const variant = variants[integer(random, 0, variants.length - 1)];
        selected.set(variant.id, (selected.get(variant.id) || 0) + integer(random, 1, 4));
      }

      const items = Array.from(selected, ([variantId, quantity]) => {
        const variant = variants.find((candidate) => candidate.id === variantId);
        assert.ok(variant, `không tìm thấy phân loại ${variantId}`);
        assert.ok(variant.stock >= quantity, `${variant.sku} không đủ tồn kho trong mô phỏng`);
        variant.stock = changePublishQuantity(variant.stock, quantity, "decrease");
        return {
          name: variant.sku,
          pancakeVariationId: variant.id,
          pancakeProductId: variant.productId,
          pancakeSku: variant.sku,
          quantity,
          unitPrice: integer(random, 79, 899) * 1000
        };
      });

      const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const productDiscount = index % 5 === 0 ? Math.min(subtotal, integer(random, 1, 100) * 1000) : 0;
      const shipping = calculateStandardShipping({
        subtotal,
        defaultFee,
        freeShippingEnabled,
        freeShippingThreshold
      });
      const shouldBeFree = freeShippingEnabled
        && defaultFee > 0
        && freeShippingThreshold > 0
        && subtotal >= freeShippingThreshold;
      const total = Math.max(0, subtotal - productDiscount + shipping.chargedFee);

      assert.equal(shipping.qualifiesForFreeShipping, shouldBeFree);
      assert.equal(shipping.discount, shouldBeFree ? defaultFee : 0);
      assert.equal(shipping.chargedFee, shouldBeFree ? 0 : defaultFee);
      if (shouldBeFree) freeShippingOrders += 1;
      else paidShippingOrders += 1;
      if (productDiscount > 0) productDiscountOrders += 1;

      const order = {
        code,
        status: "pending",
        customer: {
          name: `SHIPPING TEST ${sequence}`,
          phone: `09${String(sequence).padStart(8, "0").slice(-8)}`,
          address: "Địa chỉ mô phỏng tách biệt"
        },
        items,
        discount: productDiscount,
        shipping: shipping.chargedFee,
        shippingBaseFee: shipping.baseFee,
        shippingDiscount: shipping.discount,
        total,
        paymentMethod: index % 3 === 0 ? "zalopay" : "cod",
        inventoryReservationApplied: true,
        inventoryReservationReleased: false
      };

      assert.equal(database.has(code), false, `database không được ghi đè ${code}`);
      database.set(code, structuredClone(order));
      const stored = database.get(code);
      assert.ok(stored, `database phải đọc lại được ${code}`);
      assert.equal(stored.total, total);
      assert.equal(stored.shippingBaseFee, defaultFee);
      assert.equal(stored.shippingDiscount, shouldBeFree ? defaultFee : 0);

      const payload = buildPancakeOrderPayload(order, "test-shop", undefined, {
        id: "facebook",
        name: "facebook"
      });
      const remoteKey = pancakeOrderKey(code);
      assert.equal(pancake.has(remoteKey), false, `Pancake không được nhận trùng ${code}`);
      const remote = {
        ...structuredClone(payload),
        status: "packing",
        total_price_after_sub_discount: remotePancakeTotal(payload)
      };
      pancake.set(remoteKey, remote);

      assert.equal(remote.shipping_fee, defaultFee, `${code}: Pancake phải giữ phí ship gốc`);
      assert.equal(remote.total_discount, productDiscount + (shouldBeFree ? defaultFee : 0));
      assert.equal(remote.total_price_after_sub_discount, total, `${code}: tổng Pancake phải bằng trang khách`);
      assert.equal(remote.total_price, total, `${code}: tổng payload phải bằng trang khách`);
      assert.equal(remote.cod, order.paymentMethod === "cod" ? total : 0);
      if (!shouldBeFree) {
        assert.equal(remote.total_discount, productDiscount, `${code}: đơn không đủ điều kiện không được giảm phí ship`);
      }

      // Cấu hình admin đổi sau khi đặt không được làm thay đổi ảnh chụp tài chính của đơn.
      calculateStandardShipping({
        subtotal,
        defaultFee: fees[(index + 3) % fees.length],
        freeShippingEnabled: !freeShippingEnabled,
        freeShippingThreshold: thresholds[(index + 5) % thresholds.length]
      });
      const unchanged = database.get(code);
      assert.equal(unchanged.total, total);
      assert.equal(unchanged.shippingBaseFee, defaultFee);
      assert.equal(unchanged.shippingDiscount, shouldBeFree ? defaultFee : 0);
      groupOrders.push(code);
    }

    for (const code of groupOrders) {
      const stored = database.get(code);
      const remoteKey = pancakeOrderKey(code);
      const remote = pancake.get(remoteKey);
      assert.ok(stored && remote, `${code}: đơn phải tồn tại ở cả database và Pancake trước khi hủy`);

      stored.status = "cancelled";
      stored.shippingStatus = "cancelled";
      stored.pancakeStatus = "cancelled";
      if (!stored.inventoryReservationReleased) {
        for (const item of stored.items) {
          const variant = variants.find((candidate) => candidate.id === item.pancakeVariationId);
          assert.ok(variant);
          variant.stock = changePublishQuantity(variant.stock, item.quantity, "restore");
        }
        stored.inventoryReservationReleased = true;
      }
      database.set(code, stored);
      pancake.set(remoteKey, { ...remote, status: "cancelled" });

      // Lặp lại yêu cầu hủy phải không hoàn kho lần hai và không tạo/xóa đơn mới.
      const stockBeforeRetry = variants.reduce((sum, variant) => sum + variant.stock, 0);
      if (!stored.inventoryReservationReleased) {
        throw new Error(`${code}: cờ hoàn kho bị mất sau khi hủy`);
      }
      const stockAfterRetry = variants.reduce((sum, variant) => sum + variant.stock, 0);
      assert.equal(stockAfterRetry, stockBeforeRetry, `${code}: hủy lặp không được hoàn kho lần hai`);
    }
  }

  assert.equal(database.size, orderCount, "database giả lập phải còn đủ mọi đơn sau khi hủy");
  assert.equal(pancake.size, orderCount, "Pancake giả lập phải còn đủ mọi đơn sau khi hủy");
  for (const [code, order] of database) {
    assert.equal(order.status, "cancelled", `${code}: database phải lưu trạng thái đã hủy`);
    assert.equal(order.inventoryReservationReleased, true, `${code}: tồn kho phải được hoàn`);
    const remote = pancake.get(pancakeOrderKey(code));
    assert.ok(remote, `${code}: Pancake không được mất đơn`);
    assert.equal(remote.status, "cancelled", `${code}: Pancake phải nhận trạng thái hủy`);
    assert.equal(remote.total_price_after_sub_discount, order.total, `${code}: tổng tiền sau hủy không được đổi`);
  }
  for (const variant of variants) {
    assert.equal(variant.stock, initialStock.get(variant.id), `${variant.sku}: tồn kho cuối phải bằng ban đầu`);
  }

  return {
    batchNumber,
    orders: orderCount,
    freeShippingOrders,
    paidShippingOrders,
    productDiscountOrders,
    databaseOrders: database.size,
    pancakeOrders: pancake.size,
    cancelledOrders: Array.from(database.values()).filter((order) => order.status === "cancelled").length
  };
}

async function runSoak() {
  const durationMs = Math.max(1, Number(process.env.SOAK_DURATION_MS) || 60 * 60 * 1000);
  const orderCount = Math.max(1, Number(process.env.SOAK_BATCH_SIZE) || 2000);
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  let batchNumber = 0;
  let totalOrders = 0;
  let nextHeartbeat = startedAt;

  while (Date.now() < deadline) {
    batchNumber += 1;
    const result = runShippingPancakeBatch({ batchNumber, orderCount });
    totalOrders += result.orders;
    if (Date.now() >= nextHeartbeat) {
      process.stdout.write(`${JSON.stringify({ type: "heartbeat", elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000), batches: batchNumber, totalOrders, lastBatch: result })}\n`);
      nextHeartbeat = Date.now() + 5 * 60 * 1000;
    }
    await sleep(250);
  }

  process.stdout.write(`${JSON.stringify({ type: "complete", elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000), batches: batchNumber, totalOrders })}\n`);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await runSoak();
