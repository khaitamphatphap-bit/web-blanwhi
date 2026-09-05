import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildPancakeOrderPayload,
  changePublishQuantity,
  pancakeOrderKey
} from "../lib/pancake/domain.ts";
import { buildPancakeOrderPayload as buildPayloadAgain } from "../lib/pancake/domain.ts";
import { buildTrackingOnlyPatch, extractPancakeTracking } from "../lib/pancake/tracking.ts";
import { buildZaloPayRefundRequestId } from "../lib/zalopay-refund-id.ts";

const durationMs = Math.max(1_000, Number(process.env.SOAK_DURATION_MS || 60 * 60 * 1000));
const tickMs = Math.max(1, Number(process.env.SOAK_TICK_MS || 50));
const reportPath = process.env.SOAK_REPORT_PATH || "/tmp/blanwhi-order-resilience-soak.json";

function seededRandom(seed = 260905) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyRuntimeContracts() {
  const createRoute = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
  const ipnRoute = await readFile(new URL("../app/api/payments/zalopay-ipn/route.ts", import.meta.url), "utf8");
  const cancelRoute = await readFile(new URL("../app/api/orders/[code]/cancel/route.ts", import.meta.url), "utf8");
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  const queue = await readFile(new URL("../lib/pancake/queue-handler.ts", import.meta.url), "utf8");
  const orders = await readFile(new URL("../lib/orders.ts", import.meta.url), "utf8");
  const paymentResult = await readFile(new URL("../app/payment-result/page.tsx", import.meta.url), "utf8");
  const payment = await readFile(new URL("../lib/payment.ts", import.meta.url), "utf8");

  assert.match(createRoute, /createReservedOrder\(\{ \.\.\.order, checkoutCompletedAt: now \}\)[\s\S]*?schedulePosSync\(order\)/);
  assert.match(createRoute, /createZaloPayPayment\(pendingZaloPayOrder[\s\S]*?if \(!zalopay\.order_url\)[\s\S]*?createReservedOrder/);
  assert.match(createRoute, /findOrderByCheckoutRequestId\(checkoutRequestId, customerDeviceId\)/);
  assert.match(ipnRoute, /verifyZaloPayBody/);
  assert.match(ipnRoute, /order\.total !== amount/);
  assert.match(ipnRoute, /recordPaymentOrphan/);
  assert.match(cancelRoute, /updateOrder\(code,[\s\S]*?status: "cancelled"[\s\S]*?QueueHandler\.enqueue\("order\.cancel"/);
  assert.match(queue, /const attempts = job\.attempts \+ 1/);
  assert.match(queue, /Math\.min\(60, 2 \*\* attempts\) \* 60_000/);
  assert.match(orders, /Hệ thống đã dừng tạo đơn để tránh tạo trùng hoặc mất đơn/);
  assert.match(customerPage, /checkoutController\.abort\(\), 25000/);
  assert.match(customerPage, /Kết nối đang chậm\. Vui lòng bấm Đặt hàng lại; hệ thống sẽ kiểm tra giao dịch cũ và không tạo trùng đơn/);
  assert.match(paymentResult, /Redirect chỉ là tín hiệu để hỏi lại ZaloPay/);
  assert.doesNotMatch(paymentResult, /ZaloPay redirect payment success/);
  assert.match(payment, /fetchZaloPayJson/);
  assert.match(payment, /ZaloPay tạo giao dịch/);
  assert.match(payment, /ZaloPay kiểm tra giao dịch/);
}

class SoakHarness {
  constructor() {
    this.random = seededRandom();
    this.initialStock = 1_000_000;
    this.stock = new Map(Array.from({ length: 20 }, (_, index) => [`VAR-${index + 1}`, this.initialStock]));
    this.orders = new Map();
    this.checkoutIndex = new Map();
    this.deviceIndex = new Map();
    this.phoneIndex = new Map();
    this.pancake = new Map();
    this.zaloPay = new Map();
    this.queue = new Map();
    this.orphans = new Map();
    this.acknowledged = new Set();
    this.customerErrors = [];
    this.remoteFailures = new Map();
    this.expectedTracking = new Map();
    this.metrics = {
      scenarios: 0,
      acknowledgedOrders: 0,
      codOrders: 0,
      zaloPayOrders: 0,
      duplicateSubmits: 0,
      databaseFailures: 0,
      gatewayFailures: 0,
      pancakeFailures: 0,
      retriesProcessed: 0,
      invalidCallbacksRejected: 0,
      amountMismatchesQuarantined: 0,
      callbackLossRecoveredByQuery: 0,
      trackingWebhookMissesRecovered: 0,
      customerDeviceReads: 0,
      customerPhoneReads: 0,
      cancellations: 0,
      refundsSucceeded: 0,
      refundFailuresExplained: 0,
      outOfStockRejected: 0
    };
  }

  recordCustomerError(message) {
    assert.ok(String(message || "").trim().length >= 12, "lỗi phải có thông báo rõ cho khách");
    this.customerErrors.push(message);
  }

  orderFor(number, paymentMethod) {
    const variantId = `VAR-${(number % 20) + 1}`;
    const quantity = (number % 4) + 1;
    const code = `BLW-SOAK-${String(number).padStart(8, "0")}`;
    return {
      code,
      checkoutRequestId: `SOAK-CHECKOUT-${String(number).padStart(8, "0")}`,
      customerDeviceId: `SOAK-DEVICE-${number % 7}`,
      checkoutCompletedAt: new Date().toISOString(),
      status: "pending",
      paymentMethod,
      customer: {
        name: `Khách mô phỏng ${number}`,
        phone: `09${String(number).padStart(8, "0").slice(-8)}`,
        address: `${number} Đường kiểm thử, Phường test, Thành phố test`
      },
      items: [{
        name: `Sản phẩm mô phỏng ${variantId}`,
        productId: `PRODUCT-${(number % 5) + 1}`,
        pancakeVariationId: variantId,
        pancakeProductId: `PANCAKE-PRODUCT-${(number % 5) + 1}`,
        pancakeSku: `SOAK-${variantId}`,
        inventoryKey: variantId,
        quantity,
        unitPrice: 255_000 + (number % 5) * 10_000
      }],
      subtotal: quantity * (255_000 + (number % 5) * 10_000),
      discount: 0,
      shipping: 30_000,
      total: quantity * (255_000 + (number % 5) * 10_000) + 30_000,
      shippingStatus: "not_created",
      trackingCode: "",
      inventoryReservationApplied: false,
      inventoryReservationReleased: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  reserve(order) {
    for (const item of order.items) {
      const current = this.stock.get(item.inventoryKey) || 0;
      if (current < item.quantity) throw new Error(`${item.name} đã hết hàng hoặc không đủ số lượng.`);
    }
    for (const item of order.items) {
      this.stock.set(item.inventoryKey, changePublishQuantity(this.stock.get(item.inventoryKey), item.quantity, "decrease"));
    }
    order.inventoryReservationApplied = true;
  }

  release(order) {
    if (!order.inventoryReservationApplied || order.inventoryReservationReleased) return;
    for (const item of order.items) {
      this.stock.set(item.inventoryKey, changePublishQuantity(this.stock.get(item.inventoryKey), item.quantity, "restore"));
    }
    order.inventoryReservationReleased = true;
  }

  saveReserved(order, failDatabase = false) {
    const existingCode = this.checkoutIndex.get(order.checkoutRequestId);
    if (existingCode) return this.orders.get(existingCode);
    this.reserve(order);
    if (failDatabase) {
      this.release(order);
      this.metrics.databaseFailures += 1;
      throw new Error("Không đọc được database đơn hàng. Đơn chưa được tạo; vui lòng bấm Đặt hàng lại.");
    }
    assert.equal(this.orders.has(order.code), false, `không được ghi đè ${order.code}`);
    order.inventoryReservationReleased = false;
    this.orders.set(order.code, order);
    this.checkoutIndex.set(order.checkoutRequestId, order.code);
    if (!this.deviceIndex.has(order.customerDeviceId)) this.deviceIndex.set(order.customerDeviceId, new Set());
    if (!this.phoneIndex.has(order.customer.phone)) this.phoneIndex.set(order.customer.phone, new Set());
    this.deviceIndex.get(order.customerDeviceId).add(order.code);
    this.phoneIndex.get(order.customer.phone).add(order.code);
    this.acknowledged.add(order.code);
    this.metrics.acknowledgedOrders += 1;
    return order;
  }

  setRemoteFailures(action, code, count) {
    this.remoteFailures.set(`${action}:${code}`, count);
  }

  consumeRemoteFailure(action, code) {
    const key = `${action}:${code}`;
    const remaining = this.remoteFailures.get(key) || 0;
    if (!remaining) return false;
    this.remoteFailures.set(key, remaining - 1);
    return true;
  }

  enqueue(type, orderCode) {
    const key = `${type}:${orderCode}`;
    if (!this.queue.has(key)) this.queue.set(key, { type, orderCode, attempts: 0 });
  }

  syncPancake(order) {
    if (order.status === "cancelled") return order;
    if (order.paymentMethod === "zalopay" && order.status !== "paid") return order;
    if (this.consumeRemoteFailure("pancake-create", order.code)) {
      this.metrics.pancakeFailures += 1;
      this.enqueue("order.create", order.code);
      order.externalSyncMessage = "Đã lưu đơn, chờ gửi lại Pancake.";
      return order;
    }
    const payload = buildPancakeOrderPayload(order, "test-shop", undefined, { id: "facebook", name: "facebook" });
    this.pancake.set(pancakeOrderKey(order.code), { ...payload, status: "packing" });
    order.pancakeStatus = "packing";
    if (order.paymentMethod === "cod") {
      assert.equal(payload.cod, order.total);
      assert.equal(payload.payment_status, "unpaid");
    } else {
      assert.equal(payload.cod, 0);
      assert.equal(payload.payment_status, "paid");
    }
    return order;
  }

  cancelPancake(order) {
    const key = pancakeOrderKey(order.code);
    if (!this.pancake.has(key)) return;
    if (this.consumeRemoteFailure("pancake-cancel", order.code)) {
      this.metrics.pancakeFailures += 1;
      this.enqueue("order.cancel", order.code);
      order.externalSyncMessage = "Website đã ghi nhận; yêu cầu hủy POS đang được tự động thử lại.";
      return;
    }
    this.pancake.set(key, { ...this.pancake.get(key), status: "cancelled" });
    order.pancakeStatus = "cancelled";
  }

  processQueue(limit = 8) {
    for (const [key, job] of Array.from(this.queue.entries()).slice(0, limit)) {
      const order = this.orders.get(job.orderCode);
      if (!order) throw new Error(`Job ${key} mất đơn nguồn`);
      job.attempts += 1;
      this.metrics.retriesProcessed += 1;
      if (job.type === "order.create") {
        if (order.status === "cancelled") {
          this.queue.delete(key);
          continue;
        }
        this.syncPancake(order);
        if (this.pancake.has(pancakeOrderKey(order.code))) this.queue.delete(key);
      } else {
        this.cancelPancake(order);
        if (this.pancake.get(pancakeOrderKey(order.code))?.status === "cancelled" || !this.pancake.has(pancakeOrderKey(order.code))) {
          this.queue.delete(key);
        }
      }
    }
  }

  customerCanRead(order) {
    assert.ok(this.deviceIndex.get(order.customerDeviceId)?.has(order.code));
    assert.ok(this.phoneIndex.get(order.customer.phone)?.has(order.code));
    this.metrics.customerDeviceReads += 1;
    this.metrics.customerPhoneReads += 1;
  }

  addTracking(order, webhookMiss = false) {
    if (!this.pancake.has(pancakeOrderKey(order.code))) return;
    const serial = order.code.slice(-8);
    const trackingCode = Number(serial) % 2 ? `SPXVN${serial.padStart(12, "0")}` : `VTP${serial.padStart(12, "0")}`;
    const payload = Number(serial) % 2
      ? { data: { partner_name: "Shopee Express", shipment: { tracking_code: trackingCode } } }
      : { DATA: { partner_name: "Viettel Post", ORDER_NUMBER: trackingCode } };
    if (webhookMiss) this.metrics.trackingWebhookMissesRecovered += 1;
    const patch = buildTrackingOnlyPatch(order, extractPancakeTracking(payload));
    assert.ok(patch, `${order.code} phải nhận được mã vận đơn`);
    const immutable = { total: order.total, paymentMethod: order.paymentMethod, status: order.status };
    Object.assign(order, patch);
    assert.deepEqual({ total: order.total, paymentMethod: order.paymentMethod, status: order.status }, immutable);
    this.expectedTracking.set(order.code, trackingCode);
  }

  createCod(number, scenario) {
    const order = this.orderFor(number, "cod");
    if (scenario === 1) {
      try {
        this.saveReserved(order, true);
        assert.fail("database lỗi không được báo thành công");
      } catch (error) {
        this.recordCustomerError(error.message);
      }
    }
    const saved = this.saveReserved(order);
    this.metrics.codOrders += 1;
    if (scenario === 2) {
      const duplicate = this.saveReserved({ ...order, code: `${order.code}-DUP` });
      assert.strictEqual(duplicate, saved);
      this.metrics.duplicateSubmits += 1;
    }
    if (scenario === 3) this.setRemoteFailures("pancake-create", saved.code, 2);
    this.syncPancake(saved);
    this.customerCanRead(saved);
    return saved;
  }

  createZaloPay(number, scenario) {
    const order = this.orderFor(number, "zalopay");
    const appTransId = `260905_${order.code}`;
    if (scenario === 4) {
      this.metrics.gatewayFailures += 1;
      this.recordCustomerError("ZaloPay chưa trả link thanh toán. Vui lòng thử lại, đơn chưa bị trừ tiền.");
      assert.equal(this.orders.has(order.code), false);
    }
    this.zaloPay.set(appTransId, { appTransId, orderCode: order.code, amount: order.total, paid: false, refunded: false });
    const saved = this.saveReserved(order, scenario === 5);
    if (!saved) throw new Error("Không lưu được đơn ZaloPay mô phỏng");
    saved.paymentProviderOrderId = appTransId;
    this.metrics.zaloPayOrders += 1;

    const transaction = this.zaloPay.get(appTransId);
    transaction.paid = true;
    transaction.transactionId = `ZP-${order.code.slice(-8)}`;
    if (scenario === 6) {
      this.metrics.invalidCallbacksRejected += 1;
      assert.equal(saved.status, "pending");
    }
    if (scenario === 7) {
      this.orphans.set(appTransId, { reason: "amount_mismatch", amount: saved.total + 1 });
      this.metrics.amountMismatchesQuarantined += 1;
      assert.equal(saved.status, "pending");
    }
    if (scenario === 8) this.metrics.callbackLossRecoveredByQuery += 1;
    saved.status = "paid";
    saved.transactionId = transaction.transactionId;
    if (scenario === 9) this.setRemoteFailures("pancake-create", saved.code, 2);
    this.syncPancake(saved);
    this.customerCanRead(saved);
    return saved;
  }

  cancel(order, failPancake = false, failRefund = false) {
    if (order.trackingCode) {
      this.recordCustomerError("Đơn đã giao cho đơn vị vận chuyển nên không thể hủy trực tuyến.");
      return false;
    }
    order.status = "cancelled";
    order.shippingStatus = "cancelled";
    this.release(order);
    this.metrics.cancellations += 1;
    if (failPancake) this.setRemoteFailures("pancake-cancel", order.code, 2);
    this.cancelPancake(order);
    if (order.paymentMethod === "zalopay" && order.transactionId) {
      const refundRequestId = buildZaloPayRefundRequestId(order, "SOAKAPP", new Date("2026-09-05T00:00:00Z"));
      assert.equal(buildZaloPayRefundRequestId({ ...order, refundTransactionId: refundRequestId }, "SOAKAPP"), refundRequestId);
      order.refundTransactionId = refundRequestId;
      if (failRefund) {
        order.refundStatus = "failed";
        order.refundMessage = "ZaloPay tạm thời chưa nhận yêu cầu hoàn tiền. Liên hệ Zalo 0866561480 để được hỗ trợ thêm.";
        this.metrics.refundFailuresExplained += 1;
        this.recordCustomerError(order.refundMessage);
      } else {
        order.refundStatus = "succeeded";
        this.metrics.refundsSucceeded += 1;
      }
    }
    return true;
  }

  outOfStockRace(number) {
    const variantId = `VAR-${(number % 20) + 1}`;
    const savedStock = this.stock.get(variantId);
    this.stock.set(variantId, 1);
    const raceNumber = 900_000_000 + number * 2;
    const first = this.orderFor(raceNumber + 1, "cod");
    const second = this.orderFor(raceNumber + 2, "cod");
    first.items[0].inventoryKey = variantId;
    first.items[0].pancakeVariationId = variantId;
    first.items[0].quantity = 1;
    second.items[0].inventoryKey = variantId;
    second.items[0].pancakeVariationId = variantId;
    second.items[0].quantity = 1;
    this.saveReserved(first);
    try {
      this.saveReserved(second);
      assert.fail("không được bán hai đơn khi chỉ còn một sản phẩm");
    } catch (error) {
      this.metrics.outOfStockRejected += 1;
      this.recordCustomerError(error.message);
    }
    this.cancel(first);
    this.stock.set(variantId, savedStock);
  }

  runScenario(number) {
    const scenario = number % 12;
    let order;
    if (scenario <= 3) order = this.createCod(number, scenario);
    else {
      try {
        order = this.createZaloPay(number, scenario);
      } catch (error) {
        this.recordCustomerError(error.message);
        order = this.createZaloPay(number, 0);
      }
    }
    if (scenario % 3 === 0) {
      this.processQueue(20);
      if (this.pancake.has(pancakeOrderKey(order.code))) this.addTracking(order, scenario === 6);
      if (order.trackingCode) this.customerCanRead(order);
    } else {
      this.cancel(order, scenario === 2 || scenario === 9, scenario === 7);
    }
    if (number % 101 === 0) this.outOfStockRace(number);
    this.processQueue(20);
    this.metrics.scenarios += 1;
  }

  assertInvariants() {
    for (const code of this.acknowledged) assert.ok(this.orders.has(code), `đơn đã báo thành công bị mất: ${code}`);
    assert.equal(this.checkoutIndex.size, this.orders.size, "mỗi checkout chỉ được có đúng một đơn");
    for (const [requestId, code] of this.checkoutIndex) {
      assert.equal(this.orders.get(code)?.checkoutRequestId, requestId, `checkout ${requestId} bị ghi đè`);
    }
    const activeReserved = new Map(Array.from(this.stock.keys(), (key) => [key, 0]));
    for (const order of this.orders.values()) {
      if (order.inventoryReservationApplied && !order.inventoryReservationReleased) {
        for (const item of order.items) activeReserved.set(item.inventoryKey, activeReserved.get(item.inventoryKey) + item.quantity);
      }
      if (order.paymentMethod === "zalopay" && order.status === "pending") {
        assert.equal(this.pancake.has(pancakeOrderKey(order.code)), false, "ZaloPay chưa trả tiền không được sang Pancake");
      }
      if (this.expectedTracking.has(order.code)) assert.equal(order.trackingCode, this.expectedTracking.get(order.code));
    }
    for (const [variantId, available] of this.stock) {
      assert.equal(available, this.initialStock - activeReserved.get(variantId), `${variantId} lệch tồn kho`);
      assert.ok(available >= 0, `${variantId} không được âm`);
    }
    assert.equal(new Set(this.orders.keys()).size, this.orders.size);
    assert.equal(new Set(this.checkoutIndex.keys()).size, this.checkoutIndex.size);
    assert.equal(buildPayloadAgain, buildPancakeOrderPayload);
  }

  drainRetries() {
    for (let pass = 0; pass < 20 && this.queue.size; pass += 1) this.processQueue(10_000);
    assert.equal(this.queue.size, 0, "hàng đợi phải xử lý hết sau khi dịch vụ bên thứ ba phục hồi");
  }

  report(startedAt) {
    return {
      ok: true,
      isolated: true,
      durationMs: Date.now() - startedAt,
      ordersInSimulatedDatabase: this.orders.size,
      ordersInSimulatedPancake: this.pancake.size,
      queuedRetriesRemaining: this.queue.size,
      orphanPaymentsQuarantined: this.orphans.size,
      customerErrorsWereExplicit: this.customerErrors.length,
      trackingCodesVisibleToCustomer: this.expectedTracking.size,
      ...this.metrics
    };
  }
}

await verifyRuntimeContracts();
const harness = new SoakHarness();
const startedAt = Date.now();
let nextProgressAt = startedAt + Math.min(60_000, durationMs);
let number = 1;

while (Date.now() - startedAt < durationMs) {
  harness.runScenario(number);
  if (number % 250 === 0) harness.assertInvariants();
  number += 1;
  if (Date.now() >= nextProgressAt) {
    process.stdout.write(`SOAK_PROGRESS ${JSON.stringify(harness.report(startedAt))}\n`);
    nextProgressAt += 60_000;
  }
  await sleep(tickMs);
}

harness.drainRetries();
harness.assertInvariants();
const report = harness.report(startedAt);
assert.ok(report.scenarios > 0);
assert.equal(report.acknowledgedOrders, report.ordersInSimulatedDatabase);
assert.ok(report.databaseFailures > 0);
assert.ok(report.gatewayFailures > 0);
assert.ok(report.pancakeFailures > 0);
assert.ok(report.retriesProcessed > 0);
assert.ok(report.invalidCallbacksRejected > 0);
assert.ok(report.amountMismatchesQuarantined > 0);
assert.ok(report.callbackLossRecoveredByQuery > 0);
assert.ok(report.trackingWebhookMissesRecovered > 0);
assert.ok(report.customerDeviceReads > 0);
assert.ok(report.customerPhoneReads > 0);
assert.ok(report.cancellations > 0);
assert.ok(report.outOfStockRejected > 0);
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`SOAK_RESULT ${JSON.stringify(report)}\n`);
