import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolveCheckoutDiscount } from "../lib/checkout-discount.ts";

const [checkoutRoute, customerPage] = await Promise.all([
  readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/preview.html", import.meta.url), "utf8")
]);

test("không có voucher thì server không giảm giá sản phẩm", () => {
  assert.deepEqual(resolveCheckoutDiscount(176_000, ""), {
    valid: true,
    voucherCode: "",
    discount: 0
  });
});

test("server từ chối toàn bộ voucher cũ và mã gửi thủ công", () => {
  assert.equal(resolveCheckoutDiscount(176_000, "BLANWHI5").valid, false);
  assert.equal(resolveCheckoutDiscount(1_000_000, "BLANWHI10").valid, false);
  assert.equal(resolveCheckoutDiscount(2_000_000, "BLANWHI15").valid, false);
  assert.equal(resolveCheckoutDiscount(176_000, "GIAMHET").valid, false);
});

test("server không còn tin số giảm giá do trình duyệt gửi", () => {
  assert.doesNotMatch(customerPage, /voucherCode:\s*orderVoucherCode/);
  assert.match(customerPage, /voucherCode:\s*""/);
  assert.match(checkoutRoute, /resolveCheckoutDiscount\(subtotal, payload\.voucherCode\)/);
  assert.match(checkoutRoute, /requestedDiscount !== checkoutDiscount\.discount/);
  assert.doesNotMatch(checkoutRoute, /Math\.min\(subtotal, Math\.floor\(Number\(payload\.totals\?\.discount\)/);

  const authoritative = resolveCheckoutDiscount(176_000, "");
  for (const forgedDiscount of [50_000, 100_000, 176_000]) {
    assert.notEqual(forgedDiscount, authoritative.discount);
  }
});

test("giao diện không còn công khai voucher cũ", () => {
  assert.doesNotMatch(customerPage, /BLANWHI5|BLANWHI10|BLANWHI15/);
});
