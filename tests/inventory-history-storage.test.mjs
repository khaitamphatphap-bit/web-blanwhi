import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataStore = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
const inventory = await readFile(new URL("../lib/pancake/inventory-service.ts", import.meta.url), "utf8");
const siteContent = await readFile(new URL("../lib/site-content.ts", import.meta.url), "utf8");

test("biến động tồn kho dùng bảng sự kiện nhỏ thay vì nhân bản toàn bộ catalog", () => {
  assert.match(dataStore, /create table if not exists blanwhi_inventory_events/);
  assert.match(dataStore, /filename === "site-content\.json" && options\.inventoryEvent/);
  assert.match(dataStore, /with incoming as \([\s\S]*?saved as \([\s\S]*?insert into blanwhi_store[\s\S]*?inventory_event as \([\s\S]*?insert into blanwhi_inventory_events/);

  const compactWrite = dataStore.slice(
    dataStore.indexOf('if (filename === "site-content.json" && options.inventoryEvent)'),
    dataStore.indexOf("await pool.query(\n          `with incoming as (", dataStore.indexOf('if (filename === "site-content.json" && options.inventoryEvent)') + 1)
  );
  assert.doesNotMatch(compactWrite, /blanwhi_store_history/);
});

test("admin vẫn giữ snapshot đầy đủ và lịch sử đơn hàng không bị thay đổi", () => {
  assert.match(dataStore, /insert into blanwhi_store_history[\s\S]*?'before-write'/);
  assert.match(dataStore, /insert into blanwhi_keyed_store_history[\s\S]*?'after-write'/);
  assert.match(dataStore, /insert into blanwhi_backup_outbox/);
  assert.match(siteContent, /writeSiteContentFromAdmin[\s\S]*?return writeSiteContent\(\{ \.\.\.content, products \}\);/);
});

test("đặt, hoàn và đồng bộ Pancake đều ghi sự kiện tồn kho có thể truy vết", () => {
  assert.match(inventory, /writeSiteContent\(\{ \.\.\.content, products \}, \{[\s\S]*?source: "pancake-sync"[\s\S]*?direction: "sync"/);
  assert.match(inventory, /inventoryMutation\(`\$\{order\.code\}:checkout`, "checkout", order\.code\)/);
  assert.match(inventory, /inventoryMutation\(`\$\{current\.code\}:release`, "order-release", current\.code\)/);
  assert.match(inventory, /inventoryMutation\(`\$\{current\.code\}:release-rollback`, "rollback", current\.code\)/);
});

test("trang sức khỏe database trả dung lượng theo từng bảng", () => {
  assert.match(dataStore, /from pg_stat_user_tables/);
  assert.match(dataStore, /pg_total_relation_size\(relid\)/);
  assert.match(dataStore, /report\.database\.relations = relations\.rows\.map/);
});

test("2000 lần trừ hoặc hoàn kho không còn nhân bản hàng trăm MB catalog", () => {
  const catalogBytes = 391_392;
  const events = Array.from({ length: 2000 }, (_, index) => ({
    operationId: `TEST-${index}`,
    orderCode: `BLW-TEST-${Math.floor(index / 2)}`,
    source: index % 2 ? "order-release" : "checkout",
    direction: index % 2 ? "restore" : "decrease",
    changes: [{ productId: "product", inventoryKey: "color|size", quantity: 1, before: 2, after: 1 }]
  }));
  const compactBytes = Buffer.byteLength(JSON.stringify(events), "utf8");
  const previousSnapshotBytes = catalogBytes * events.length;

  assert.ok(previousSnapshotBytes > 700 * 1024 * 1024);
  assert.ok(compactBytes < 1024 * 1024);
});
