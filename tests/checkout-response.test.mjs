import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("COD trả kết quả sau khi database lưu, không chờ R2 hoặc Pancake", async () => {
  const source = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");

  assert.match(source, /onlineMethods\.has\(paymentMethod\) \? readIntegrationConfig\(\) : Promise\.resolve\(null\)/);
  assert.match(source, /function schedulePosSync\(order: ShopOrder\) \{\s*after\(async \(\) =>/);
  assert.match(source, /if \(pancakeConfigured && paymentMethod === "cod"\) \{\s*schedulePosSync\(order\);\s*return json\(\{ order, syncQueued: true \}\);/);
  assert.doesNotMatch(source, /if \(pancakeConfigured && paymentMethod === "cod"\) \{\s*(?:const syncQueued = )?await queuePosSync/);
});
