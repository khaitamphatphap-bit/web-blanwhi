import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

test("nút đơn hàng giữ nguyên hành vi và chỉ cố định trên màn hình điện thoại", () => {
  assert.equal((customerPage.match(/id="ordersLink"/g) || []).length, 1);
  assert.match(customerPage, /orders-link-label-desktop">Đơn hàng của tôi<\/span>/);
  assert.match(customerPage, /orders-link-label-mobile" aria-hidden="true">Đơn hàng<\/span>/);
  assert.match(customerPage, /\.orders-link-label-mobile \{ display: none; \}/);
  assert.match(customerPage, /\.orders-link-label-desktop \{ display: none; \}/);
  assert.match(customerPage, /#searchToggle \{ margin-right: 92px; \}/);
  assert.match(customerPage, /\.orders-link \{ position: fixed; top: max\(12px, env\(safe-area-inset-top\)\); right: 12px; z-index: 19;/);
  assert.match(customerPage, /document\.getElementById\("ordersLink"\)\.addEventListener\("click", openOrders\);/);
});
