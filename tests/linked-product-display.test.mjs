import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [siteContent, siteEditor, customerPage, checkoutRoute] = await Promise.all([
  readFile(new URL("../lib/site-content.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/site/site-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../public/preview.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8")
]);

test("sản phẩm cũ luôn mặc định là bán trực tiếp", () => {
  assert.match(siteContent, /displayMode: product\.displayMode === "linked" \? "linked" : "direct"/);
  assert.match(customerPage, /displayMode: product\.displayMode === "linked" \? "linked" : "direct"/);
  assert.match(siteEditor, /displayMode: "direct"/);
});

test("giao diện bán trực tiếp giữ nguyên nút mua và thêm giỏ", () => {
  assert.match(customerPage, /data-buy="\$\{product\.id\}"/);
  assert.match(customerPage, /data-add="\$\{product\.id\}"/);
  assert.match(customerPage, /if \(product\.displayMode === "linked"\)[\s\S]*?ensureValidProductSelection\(product\)/);
  assert.match(siteEditor, /Giữ nguyên giá, phân loại, tồn kho, giỏ hàng và thanh toán trên website/);
});

test("sản phẩm liên kết chỉ có ảnh, dải chữ và nút chuyển trang", () => {
  assert.match(customerPage, /linked-product-ribbon/);
  assert.match(customerPage, /linked-product-cta/);
  assert.match(customerPage, /target="_blank" rel="noopener noreferrer"/);
  assert.match(siteEditor, /Nội dung sản phẩm liên kết/);
  assert.match(siteEditor, /Ảnh nhỏ trong nút/);
});

test("server không cho sản phẩm liên kết đi vào thanh toán", () => {
  assert.match(checkoutRoute, /product\.displayMode === "linked"/);
  assert.match(checkoutRoute, /là sản phẩm liên kết và không thể thanh toán trên website này/);
  assert.match(siteContent, /chỉ được dùng link http hoặc https/);
});

test("phạm vi admin chỉ bổ sung trong ProductForm", () => {
  assert.match(siteEditor, /function ProductForm\(/);
  assert.match(siteEditor, /Hình thức hiển thị sản phẩm/);
  assert.doesNotMatch(siteEditor, /Hình thức hiển thị đơn hàng|Hình thức hiển thị thanh toán/);
});
