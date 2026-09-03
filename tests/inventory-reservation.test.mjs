import assert from "node:assert/strict";
import test from "node:test";
import { changePublishQuantity } from "../lib/pancake/domain.ts";

test("10 đơn liên tiếp trừ chính xác 10 sản phẩm khỏi tồn website", () => {
  let stock = 43;
  for (let index = 0; index < 10; index += 1) {
    stock = changePublishQuantity(stock, 1, "decrease");
  }
  assert.equal(stock, 33);
});

test("tồn kho không thể bị trừ thành số âm", () => {
  assert.equal(changePublishQuantity(2, 5, "decrease"), 0);
});

test("hủy đơn trả lại đúng số lượng đã giữ", () => {
  const reserved = changePublishQuantity(8, 3, "decrease");
  assert.equal(changePublishQuantity(reserved, 3, "restore"), 8);
});
