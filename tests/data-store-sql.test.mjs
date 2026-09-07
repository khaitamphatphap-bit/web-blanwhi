import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ghi database ưu tiên lưu bản chính trước backup để tránh deadlock", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  const writeRecord = source.slice(
    source.indexOf("export async function writeKeyedJsonRecord"),
    source.indexOf("export async function readKeyedJsonStoreHistory")
  );
  assert.match(writeRecord, /with saved as \([\s\S]*?insert into blanwhi_keyed_store[\s\S]*?on conflict \(namespace, item_key\)/);
  assert.match(writeRecord, /history as \([\s\S]*?insert into blanwhi_keyed_store_history[\s\S]*?'after-write'/);
  assert.match(writeRecord, /backup as \([\s\S]*?insert into blanwhi_backup_outbox/);
  assert.match(writeRecord, /select 1 as changed from saved/);
  assert.match(source, /R2 mirroring is drained by cron, never checkout/);
  assert.doesNotMatch(writeRecord, /mirrorDatabaseKeyedRecordToR2/);
});

test("ghi nhiều record theo lô nhỏ để không làm nghẽn pool Neon", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /export async function writeKeyedJsonRecords[\s\S]*?const concurrency = 3;[\s\S]*?entries\.slice\(index, index \+ concurrency\)/);
});

test("nội dung website và tồn kho dùng database, tự giữ dữ liệu R2 khi chuyển lần đầu", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /return hasDatabase\(\) && !\["integrations\.json", "orders\.json"\]\.includes\(filename\)/);
  assert.match(source, /filename === "site-content\.json" && hasR2Store\(\)[\s\S]*?readR2JsonStore<T>\(\)[\s\S]*?writeJsonStore\(filename, r2Value\)/);
  assert.match(source, /SITE_CONTENT_R2_SEED_MISSING/);
  assert.match(source, /filename === "site-content\.json" && hasDatabase\(\)[\s\S]*?SITE_CONTENT_DATABASE_UNAVAILABLE/);
});

test("mỗi cập nhật tồn kho đọc lại catalog sau khi lấy database lock", async () => {
  const source = await readFile(new URL("../lib/site-content.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /siteContentRequest/);
  assert.match(source, /export async function readSiteContent\(\): Promise<SiteContent> \{[\s\S]*?return loadSiteContent\(\)/);
});

test("database lock tự giải phóng khi function bị ngắt", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /blanwhi-v2:/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /set local lock_timeout = '12s'/);
  assert.doesNotMatch(source, /pg_advisory_lock\(/);
  assert.doesNotMatch(source, /pg_advisory_unlock\(/);
});

test("database khỏe không đọc song song R2 hoặc file fallback", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /max: 3/);
  assert.match(source, /connectionTimeoutMillis: 5_000/);
  assert.match(source, /const result = await readKeyedJsonStoreDatabaseStatus<T>\(namespace\);[\s\S]*?if \(result\.ok\) return result\.records;[\s\S]*?return readKeyedJsonStoreFallbackStores<T>/);
  assert.doesNotMatch(source, /const \[result, legacy\] = await Promise\.all/);
});

test("đọc danh sách đơn chỉ mở backup khi database lỗi", async () => {
  const source = await readFile(new URL("../lib/orders.ts", import.meta.url), "utf8");
  assert.match(source, /if \(databaseState\.ok\) \{[\s\S]*?compactOrders\(Object\.values\(databaseState\.records\)/);
  assert.match(source, /Disaster recovery is intentionally cold-path/);
});
