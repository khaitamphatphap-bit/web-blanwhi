import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ghi database ưu tiên lưu bản chính trước backup để tránh deadlock", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /insert into blanwhi_keyed_store \(namespace, item_key, item_value, updated_at\)[\s\S]*?on conflict \(namespace, item_key\)/);
  assert.match(source, /item_value is distinct from excluded\.item_value[\s\S]*?if \(!saved\.rows\.length\) return value/);
  assert.match(source, /write database history/);
  assert.match(source, /queue database backup/);
  assert.match(source, /must never reject checkout or cancellation/);
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
