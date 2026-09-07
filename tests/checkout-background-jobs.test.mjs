import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ServerTiming } from "../lib/server-timing.ts";

const createRoute = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
const cancelRoute = await readFile(new URL("../app/api/orders/[code]/cancel/route.ts", import.meta.url), "utf8");
const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const pollCron = await readFile(new URL("../app/api/admin/pancake/poll/route.ts", import.meta.url), "utf8");
const shippingCron = await readFile(new URL("../app/api/admin/orders/shipping-sync/route.ts", import.meta.url), "utf8");
const queue = await readFile(new URL("../lib/pancake/queue-handler.ts", import.meta.url), "utf8");
const backgroundJobs = await readFile(new URL("../lib/order-background-jobs.ts", import.meta.url), "utf8");
const refundWorker = await readFile(new URL("../lib/zalopay-cancel-refund.ts", import.meta.url), "utf8");
const dataStore = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");

test("cron Vercel dùng Bearer CRON_SECRET ở middleware và hai route nền", () => {
  assert.match(middleware, /cronAuthorization === `Bearer \$\{cronSecret\}`/);
  assert.doesNotMatch(middleware, /cronPath && request\.headers\.get\("x-vercel-cron"\)/);
  assert.match(pollCron, /auth !== `Bearer \$\{secret\}`/);
  assert.doesNotMatch(pollCron, /x-vercel-cron/);
  assert.match(shippingCron, /request\.headers\.get\("authorization"\) === `Bearer \$\{cronSecret\}`/);
});

test("checkout không quét giao dịch ZaloPay cũ và không chờ Pancake hoặc R2", () => {
  assert.doesNotMatch(createRoute, /expireStaleZaloPayReservations|reconcilePendingZaloPayPayments/);
  assert.match(createRoute, /QueueHandler\.enqueue\("order\.create"/);
  assert.match(createRoute, /after\(async \(\) =>/);
  const keyedWrite = dataStore.slice(
    dataStore.indexOf("export async function writeKeyedJsonRecord"),
    dataStore.indexOf("export async function readKeyedJsonStoreHistory")
  );
  assert.match(keyedWrite, /insert into blanwhi_backup_outbox/);
  assert.doesNotMatch(keyedWrite, /writeR2|mirrorDatabaseKeyedRecordToR2/);
});

test("hủy chỉ chờ database và hoàn kho; mọi API ngoài hệ thống chạy qua outbox", () => {
  assert.match(cancelRoute, /timing\.measure\("database_cancel"/);
  assert.match(cancelRoute, /timing\.measure\("inventory_restore"/);
  assert.match(cancelRoute, /QueueHandler\.enqueue\("order\.cancel"/);
  assert.match(cancelRoute, /QueueHandler\.enqueue\("express\.cancel"/);
  assert.match(cancelRoute, /QueueHandler\.enqueue\("zalopay\.refund"/);
  assert.match(cancelRoute, /QueueHandler\.enqueue\("inventory\.release"/);
  assert.doesNotMatch(cancelRoute, /PancakeService|OrderSyncService|requestAutomaticZaloPayRefund|queryZaloPayPayment/);
  assert.match(backgroundJobs, /job\.type === "inventory\.release"[\s\S]*?releaseOrder\(order\)/);
});

test("worker chỉ hoàn tất khi bên thứ ba xác nhận và giữ job để retry khi còn pending", () => {
  assert.match(backgroundJobs, /job\.type === "express\.cancel"[\s\S]*?cancelled\.shippingStatus !== "cancelled"[\s\S]*?throw new Error/);
  assert.match(backgroundJobs, /job\.type === "zalopay\.refund"[\s\S]*?!result\.completed[\s\S]*?throw new Error/);
  assert.match(refundWorker, /refundStatus === "succeeded" \|\| order\.refundStatus === "not_required"/);
  assert.match(refundWorker, /else if \(returnCode === 2\)/);
  assert.match(refundWorker, /else \{\s*throw new Error/);
});

test("cron ưu tiên hàng đợi khách và xử lý theo lô hữu hạn", () => {
  const queueIndex = pollCron.indexOf("QueueHandler.process");
  const reconciliationIndex = pollCron.indexOf("const paymentReservations =");
  assert.ok(queueIndex >= 0 && reconciliationIndex > queueIndex);
  assert.match(pollCron, /\{ limit: 20, concurrency: 4 \}/);
  assert.match(queue, /slice\(0, limit\)/);
  assert.match(queue, /index \+= concurrency/);
  assert.match(queue, /failedJobs\.set\(job\.id/);
});

test("checkout và hủy trả số đo Server-Timing theo từng bước", async () => {
  assert.match(createRoute, /new ServerTiming\(\)/);
  assert.match(createRoute, /timing\.headers\("checkout"\)/);
  assert.match(cancelRoute, /timing\.headers\("customer-cancel"\)/);

  const timing = new ServerTiming();
  await timing.measure("database", async () => undefined);
  const headers = timing.headers("test", Number.POSITIVE_INFINITY);
  assert.match(headers["Server-Timing"], /database;dur=/);
  assert.match(headers["Server-Timing"], /total;dur=/);
  assert.match(headers["X-BLANWHI-Duration-Ms"], /^\d+$/);
});
