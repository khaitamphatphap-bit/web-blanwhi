import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataStore = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
const siteContent = await readFile(new URL("../lib/site-content.ts", import.meta.url), "utf8");
const siteEditor = await readFile(new URL("../app/admin/site/site-editor.tsx", import.meta.url), "utf8");

test("catalog không dùng bản R2 cũ khi database đã được cấu hình", () => {
  assert.match(
    dataStore,
    /if \(!hasDatabase\(\) && hasR2Store\(\) && filename === "site-content\.json"\)/
  );
  assert.match(
    dataStore,
    /if \(filename === "site-content\.json" && hasDatabase\(\)\) \{[\s\S]*?SITE_CONTENT_DATABASE_UNAVAILABLE/
  );
  assert.doesNotMatch(dataStore, /SITE_CONTENT_R2_SEED_MISSING/);
});

test("admin từ chối tab cũ thay vì ghi đè sản phẩm và URL ảnh mới", () => {
  assert.match(siteContent, /catalogRevision\?: number/);
  assert.match(siteContent, /incomingRevision !== latestRevision/);
  assert.match(siteContent, /SITE_CONTENT_REVISION_CONFLICT/);
  assert.match(siteContent, /catalogRevision: nextRevision/);
});

test("admin xác minh phiên bản database trước khi báo lưu thành công", () => {
  assert.match(siteContent, /readAuthoritativeJsonStore<SiteContent>\("site-content\.json"\)/);
  assert.match(siteContent, /Number\(verified\.catalogRevision\) !== nextRevision/);
  assert.match(siteEditor, /Number\(saved\.catalogRevision\) <= Number\(contentWithPolicies\.catalogRevision \|\| 0\)/);
});
