import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const previewPath = new URL("../public/preview.html", import.meta.url);

test("adding a configured product keeps the storefront open", async () => {
  const source = await readFile(previewPath, "utf8");

  assert.match(source, /async function addToCartAndStay\(id, options = \{\}, preferredRoot = null\)/);
  assert.match(source, /const added = await addToCart\(id, options\);\s*if \(added\) animateProductToCart\(id, snapshot\);/);
  assert.match(source, /else if \(variantState\.mode === "buy"\) await buyNow\(product\.id, purchaseOptions\);\s*else await addToCartAndStay\(product\.id, purchaseOptions\);/);
  assert.doesNotMatch(source, /if \(await addToCart\(product\.id, purchaseOptions\)\) openCart\(\)/);
});

test("buy now still opens the existing cart flow", async () => {
  const source = await readFile(previewPath, "utf8");

  assert.match(source, /async function buyNow\(id, options = \{\}\)[\s\S]*?openCart\(\);/);
  assert.match(source, /const paymentApiBase = location\.port === "8002" \? "http:\/\/127\.0\.0\.1:3003" : "";/);
});

test("cart feedback is visual only and does not call order APIs", async () => {
  const source = await readFile(previewPath, "utf8");
  const helper = source.match(/function animateProductToCart\(productId, snapshot = null\) \{[\s\S]*?\n      \}/)?.[0] || "";

  assert.match(helper, /showCartAdded/);
  assert.match(helper, /flyer\.animate/);
  assert.doesNotMatch(helper, /fetch\(|\/api\/|openCart\(|checkout|payment|order/);
});
