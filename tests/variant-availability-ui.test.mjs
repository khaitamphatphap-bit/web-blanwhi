import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const customerPage = fs.readFileSync(new URL("../public/preview.html", import.meta.url), "utf8");

function loadSelectionHelpers() {
  const start = customerPage.indexOf("const sizeHasStock =");
  const end = customerPage.indexOf("const classificationHasStock =", start);
  assert.ok(start >= 0 && end > start, "Không tìm thấy logic lọc màu/size trong trang khách");
  const context = {
    inventoryIsManaged: (product) => product.inventoryManaged,
    variantSwatches: (product) => product.swatches,
    hasStock: (product, { color, size }) => Number(product.stock[`${color}|${size}`] || 0) > 0
  };
  vm.runInNewContext(`${customerPage.slice(start, end)}\nthis.helpers = { sizeHasStock, colorHasSelectedSize, selectSizeAndMatchColor, selectColorAndMatchSize };`, context);
  return context.helpers;
}

test("size ban đầu còn nếu ít nhất một màu có tồn", () => {
  const helpers = loadSelectionHelpers();
  const product = {
    inventoryManaged: true,
    swatches: ["den", "trang"],
    sizes: ["S", "M", "L"],
    stock: { "den|S": 2, "trang|M": 3 },
    color: "den",
    colorIndex: 0,
    size: "S"
  };

  assert.equal(helpers.sizeHasStock(product, "S"), true);
  assert.equal(helpers.sizeHasStock(product, "M"), true);
  assert.equal(helpers.sizeHasStock(product, "L"), false);
});

test("chọn size lọc màu và chọn màu lọc size nhưng luôn giữ tổ hợp còn hàng", () => {
  const helpers = loadSelectionHelpers();
  const product = {
    inventoryManaged: true,
    swatches: ["den", "trang"],
    sizes: ["S", "M", "L"],
    stock: { "den|S": 2, "trang|M": 3 },
    color: "den",
    colorIndex: 0,
    size: "S",
    selectionAxis: "all"
  };

  helpers.selectSizeAndMatchColor(product, "M");
  assert.equal(product.color, "trang");
  assert.equal(product.size, "M");
  assert.equal(product.selectionAxis, "size");

  helpers.selectColorAndMatchSize(product, 0);
  assert.equal(product.color, "den");
  assert.equal(product.size, "S");
  assert.equal(product.selectionAxis, "color");
});

test("lựa chọn không hợp với tổ hợp hiện tại chỉ làm mờ nhưng vẫn bấm được", () => {
  assert.match(customerPage, /class="\$\{size === selectedSize[^\n]+out-of-stock/);
  assert.match(customerPage, /alternativeStock \? " alternative-stock"/);
  assert.match(customerPage, /fullyOut \? " fully-out"/);
  assert.match(customerPage, /\.sizes button\.out-of-stock\.alternative-stock \{ border-color: #aaa; \}/);
  assert.match(customerPage, /out-of-stock\.fully-out[^\n]+cursor: not-allowed/);
  assert.match(customerPage, /bấm để xem size còn hàng/);
  assert.doesNotMatch(customerPage, /data-stock-state="\$\{out \? "out" : "in"\}" \$\{out \? "disabled"/);
  assert.match(customerPage, /data-variant-color="\$\{index\}"/);
  assert.doesNotMatch(customerPage, /out \? "hidden"/);
});
