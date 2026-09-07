import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

test("nút đơn hàng giữ nguyên hành vi và chỉ đổi nhãn theo màn hình", () => {
  assert.equal((customerPage.match(/id="ordersLink"/g) || []).length, 1);
  assert.match(customerPage, /orders-link-label-desktop">Đơn hàng của tôi<\/span>/);
  assert.match(customerPage, /orders-link-label-mobile" aria-hidden="true">Đơn hàng<\/span>/);
  assert.match(customerPage, /\.orders-link-label-mobile \{ display: none; \}/);
  assert.match(customerPage, /\.orders-link-label-desktop \{ display: none; \}/);
  assert.match(customerPage, /\.orders-link \{ position: static;/);
  assert.match(customerPage, /document\.getElementById\("ordersLink"\)\.addEventListener\("click", openOrders\);/);
});
