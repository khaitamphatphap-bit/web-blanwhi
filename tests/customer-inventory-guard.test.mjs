import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
const availabilityRoute = await readFile(new URL("../app/api/inventory/availability/route.ts", import.meta.url), "utf8");

test("khóa nút mua cho đến khi tải xong tồn kho mới nhất", () => {
  assert.match(customerPage, /availabilityLoading: true/);
  assert.match(customerPage, /checkingAvailability \? "Đang kiểm tra tồn kho\.\.\."/);
  assert.match(customerPage, /refreshProductAvailability\(id, true\)/);
  assert.doesNotMatch(customerPage, /skipAvailabilityRefresh/);
});

test("kiểm tra lại toàn bộ giỏ trước khi mở checkout và trước khi tạo đơn", () => {
  assert.match(customerPage, /async function validateCartAvailability\(\)/);
  assert.match(customerPage, /if \(!await validateCartAvailability\(\)\)/);
  assert.match(customerPage, /phân loại đã chọn hiện đã hết hàng/);
});

test("API khách đọc tồn website mà không phụ thuộc thời gian phản hồi Pancake", () => {
  assert.match(availabilityRoute, /refreshPancake && service\.configured\(\)/);
  assert.match(availabilityRoute, /url\.searchParams\.get\("refreshPancake"\) === "true"/);
});

test("trang khách chỉ tải lại toàn bộ tồn kho khi admin đã lưu phiên bản mới", () => {
  assert.match(customerPage, /summary=true/);
  assert.match(customerPage, /latestVersion !== inventoryVersion/);
  assert.match(availabilityRoute, /inventoryVersion/);
  assert.match(availabilityRoute, /s-maxage=2/);
});
