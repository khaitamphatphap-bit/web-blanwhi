import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ghi database ưu tiên lưu bản chính trước backup để tránh deadlock", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /insert into blanwhi_keyed_store \(namespace, item_key, item_value, updated_at\)[\s\S]*?on conflict \(namespace, item_key\)/);
  assert.match(source, /write database history/);
  assert.match(source, /queue database backup/);
  assert.match(source, /must never reject checkout or cancellation/);
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
