import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("các CTE lưu đơn được ngăn cách đúng cú pháp SQL", async () => {
  const source = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  assert.match(source, /backup as \([\s\S]*?returning id\s*\),\s*saved as \(/);
  assert.match(source, /saved as \([\s\S]*?returning namespace, item_key, item_value\s*\),\s*queued as \(/);
});
