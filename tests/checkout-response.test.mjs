import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("COD trả kết quả sau khi database lưu, không chờ R2 hoặc Pancake", async () => {
  const source = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
  const databaseIndex = source.lastIndexOf('order = await timing.measure("database"');
  const outboxIndex = source.indexOf('const queued = await timing.measure("outbox"', databaseIndex);
  const scheduleIndex = source.indexOf("schedulePosSync(order, queued?.id)", outboxIndex);
  const responseIndex = source.indexOf("return respond({ order, syncQueued: Boolean(queued) })", scheduleIndex);

  assert.match(source, /onlineMethods\.has\(paymentMethod\) \? readIntegrationConfig\(\) : Promise\.resolve\(null\)/);
  assert.match(source, /function schedulePosSync\(order: ShopOrder, queuedJobId\?: string\) \{\s*after\(async \(\) =>/);
  assert.ok(databaseIndex >= 0, "phải lưu đơn và trừ tồn trước");
  assert.ok(outboxIndex > databaseIndex, "phải ghi hàng đợi bền vững sau khi lưu đơn");
  assert.ok(scheduleIndex > outboxIndex, "chỉ chạy Pancake nền sau khi đã có job");
  assert.ok(responseIndex > scheduleIndex, "phản hồi sau khi database và outbox xác nhận");
  assert.doesNotMatch(source, /expireStaleZaloPayReservations/);
});
