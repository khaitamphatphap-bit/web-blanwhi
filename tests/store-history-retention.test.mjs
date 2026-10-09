import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dataStore = fs.readFileSync(new URL("../lib/data-store.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/admin/storage-health/route.ts", import.meta.url), "utf8");

test("lịch sử thường xuyên thay đổi được giới hạn theo từng store", () => {
  assert.match(dataStore, /const boundedStoreHistoryRetention/);
  assert.match(dataStore, /delete from blanwhi_store_history/);
  assert.match(dataStore, /reason = 'before-write'/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_keyed_store/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_keyed_store_history/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_inventory_events/);
});

test("giữ số lượng lịch sử cần thiết cho catalog, log, queue và routing", () => {
  assert.match(dataStore, /"site-content": 250/);
  assert.match(dataStore, /"pancake-logs": 10/);
  assert.match(dataStore, /"pancake-queue": 50/);
  assert.match(dataStore, /"pancake-routing": 50/);
  assert.match(dataStore, /"pancake-links-shop-2": 50/);
});

test("cron vận chuyển không tạo lại snapshot toàn bộ đơn sau khi đã có keyed history", () => {
  const shippingSync = fs.readFileSync(new URL("../app/api/admin/orders/shipping-sync/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(shippingSync, /before-full-shipping-sync/);
  assert.doesNotMatch(shippingSync, /createJsonStoreBackup/);
});

test("đường dọn một lần đã được khóa sau khi hoàn tất", () => {
  assert.doesNotMatch(route, /prune-redundant-store-history/);
  assert.doesNotMatch(route, /PRUNE_REDUNDANT_STORE_HISTORY_V1/);
});
