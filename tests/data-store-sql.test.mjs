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
