import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dataStore = fs.readFileSync(new URL("../lib/data-store.ts", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/admin/storage-health/route.ts", import.meta.url), "utf8");

test("dọn lịch sử chỉ đụng các store cấu hình và giữ nguyên khóa lạ", () => {
  assert.match(dataStore, /const boundedStoreHistoryRetention/);
  assert.match(dataStore, /where store_key <> all\(\$1::text\[\]\) or reason <> 'before-write'/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_keyed_store/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_keyed_store_history/);
  assert.doesNotMatch(dataStore, /truncate table blanwhi_inventory_events/);
});

test("giữ backup thủ công, snapshot hiện tại và lịch sử catalog cần thiết", () => {
  assert.match(dataStore, /'pre-history-cleanup-current'/);
  assert.match(dataStore, /reason <> 'before-write'/);
  assert.match(dataStore, /when 'site-content' then 250/);
  assert.match(dataStore, /when 'pancake-logs' then 10/);
  assert.match(dataStore, /ordersAndKeyedHistoryUntouched: true/);
});

test("API dọn yêu cầu hành động và mã xác nhận riêng", () => {
  assert.match(route, /body\.action === "prune-redundant-store-history"/);
  assert.match(route, /body\.confirmation !== "PRUNE_REDUNDANT_STORE_HISTORY_V1"/);
});
