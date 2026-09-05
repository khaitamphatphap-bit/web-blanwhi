import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isExpiredPendingZaloPayReservation,
  zaloPayReservationExpiresAt,
  zaloPayReservationLifetimeMs
} from "../lib/zalopay-reservation-policy.ts";

test("lượt giữ tồn ZaloPay kéo dài đúng 5 phút", () => {
  const now = Date.parse("2026-09-05T00:00:00.000Z");
  assert.equal(zaloPayReservationLifetimeMs, 300_000);
  assert.equal(zaloPayReservationExpiresAt(now), "2026-09-05T00:05:00.000Z");
});

test("chỉ trả lượt giữ ZaloPay pending đã thực sự hết hạn", () => {
  const expiresAt = "2026-09-05T00:05:00.000Z";
  const active = {
    paymentMethod: "zalopay",
    status: "pending",
    inventoryReservationApplied: true,
    inventoryReservationReleased: false,
    inventoryReservationExpiresAt: expiresAt
  };
  assert.equal(isExpiredPendingZaloPayReservation(active, Date.parse("2026-09-05T00:04:59.999Z")), false);
  assert.equal(isExpiredPendingZaloPayReservation(active, Date.parse(expiresAt)), true);
  assert.equal(isExpiredPendingZaloPayReservation({ ...active, status: "paid" }, Date.parse(expiresAt)), false);
  assert.equal(isExpiredPendingZaloPayReservation({ ...active, inventoryReservationReleased: true }, Date.parse(expiresAt)), false);
  assert.equal(isExpiredPendingZaloPayReservation({ ...active, paymentMethod: "cod" }, Date.parse(expiresAt)), false);
});

test("luồng ZaloPay giữ tồn trước khi trả link và dùng chung khóa khi thanh toán hoặc hết hạn", async () => {
  const createRoute = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
  const payment = await readFile(new URL("../lib/payment.ts", import.meta.url), "utf8");
  const inventory = await readFile(new URL("../lib/pancake/inventory-service.ts", import.meta.url), "utf8");

  assert.match(payment, /expire_duration_seconds: "300"/);
  assert.match(createRoute, /if \(paymentMethod === "zalopay"\)[\s\S]*?createZaloPayPayment[\s\S]*?inventoryService\.createReservedOrder[\s\S]*?return json/);
  assert.match(inventory, /confirmReservedPayment[\s\S]*?withDataStoreLock\("website-inventory"/);
  assert.match(inventory, /expireZaloPayReservation[\s\S]*?withDataStoreLock\("website-inventory"/);
});

test("luồng COD vẫn giữ nguyên cơ chế tạo đơn đã giữ tồn", async () => {
  const createRoute = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
  assert.match(createRoute, /order = await inventoryService\.createReservedOrder\(\{ \.\.\.order, checkoutCompletedAt: now \}\)/);
  assert.match(createRoute, /pancakeConfigured && paymentMethod === "cod"[\s\S]*?schedulePosSync\(order\)/);
});
