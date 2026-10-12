import assert from "node:assert/strict";
import test from "node:test";
import { pancakePosOrderCode, shop2SpxOrderCode } from "../lib/order-code.ts";

test("Shop 1 giữ nguyên mã POS đang vận hành", () => {
  const code = "BLW-261009061611-IXBO";
  assert.equal(pancakePosOrderCode(code, "shop-1"), code);
});

test("Shop 2 dùng alias SPX tối đa 16 ký tự nhưng không sửa mã đơn gốc", () => {
  const code = "BLW-261009061611-IXBO";
  const alias = pancakePosOrderCode(code, "shop-2");
  assert.equal(alias, "B61009061611IXBO");
  assert.equal(alias.length, 16);
  assert.equal(code, "BLW-261009061611-IXBO");
});

test("alias Shop 2 ổn định, chỉ gồm chữ số/chữ cái và phân biệt các mã thông dụng", () => {
  const codes = Array.from({ length: 10_000 }, (_, index) => {
    const tail = index.toString(36).toUpperCase().padStart(4, "0").slice(-4);
    return `BLW-261009061611-${tail}`;
  });
  const aliases = codes.map(shop2SpxOrderCode);
  assert.equal(new Set(aliases).size, codes.length);
  assert.ok(aliases.every((alias) => alias.length <= 16 && /^[A-Z0-9]+$/.test(alias)));
  assert.deepEqual(codes.map(shop2SpxOrderCode), aliases);
});

test("mã bất thường dài vẫn được rút gọn ổn định", () => {
  const code = "BLANWHI:VERY-LONG-ORDER-CODE-THAT-WOULD-EXCEED-SPX";
  const alias = shop2SpxOrderCode(code);
  assert.equal(alias.length, 16);
  assert.equal(shop2SpxOrderCode(code), alias);
});
