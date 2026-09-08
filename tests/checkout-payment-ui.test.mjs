import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const previewPath = new URL("../public/preview.html", import.meta.url);

test("đổi giao diện thanh toán trước nhưng giữ nguyên mã ZaloPay gửi API", async () => {
  const source = await readFile(previewPath, "utf8");

  assert.match(source, /name="pay" value="cod" checked/);
  assert.match(source, /name="pay" value="zalopay"/);
  assert.match(source, /const paymentMethodMap = \{ zalopay: "zalopay" \}/);
  assert.match(source, /body: JSON\.stringify\(\{[\s\S]*?checkoutRequestId: checkoutRequestState\.id,[\s\S]*?paymentMethod,[\s\S]*?customer: order\.customer/);
  assert.match(source, /<strong>Thanh toán trước<\/strong>/);
  assert.match(source, /ZaloPay \(chuyển khoản, quét mã QR\)/);
  assert.match(source, /name="prepayGateway" value="zalopay" checked/);
  assert.doesNotMatch(source, /paymentUiDemo/);
});
