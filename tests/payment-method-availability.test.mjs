import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const [methodsRoute, checkoutRoute, customerPage, ipnRoute, confirmation, reservation, refundService] = await Promise.all([
  readFile(new URL("../app/api/payments/methods/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/preview.html", import.meta.url), "utf8"),
  readFile(new URL("../app/api/payments/zalopay-ipn/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/payment-confirmation.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/zalopay-reservation.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/zalopay-refund-service.ts", import.meta.url), "utf8")
]);

test("API phương thức thanh toán đọc công tắc ZaloPay từ admin", () => {
  assert.match(methodsRoute, /readIntegrationConfig\(\)/);
  assert.match(methodsRoute, /zalopay:\s*integrations\.payment\.zalopay\.enabled === true/);
  assert.doesNotMatch(methodsRoute, /zalopay:\s*true/);
});

test("trang khách ẩn ZaloPay mặc định và chỉ hiện khi API xác nhận đang bật", () => {
  assert.match(customerPage, /data-payment-option="zalopay" hidden/);
  assert.match(customerPage, /name="pay" value="zalopay" disabled/);
  assert.match(customerPage, /const enabled = methods\?\.\[method\] === true/);
  assert.match(customerPage, /label\.hidden = !enabled/);
  assert.match(customerPage, /input\.disabled = !enabled/);
  assert.match(customerPage, /cod\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(customerPage, /async function openCheckout\(\) \{\s*await loadAvailablePaymentMethods\(\)/);
});

test("server chặn giao dịch ZaloPay mới khi admin tắt nhưng COD không phụ thuộc công tắc", () => {
  assert.match(checkoutRoute, /paymentMethod === "zalopay" && integrations\?\.payment\.zalopay\.enabled !== true/);
  assert.match(checkoutRoute, /ZaloPay đang tạm tắt\. Vui lòng chọn thanh toán COD\./);
  assert.match(checkoutRoute, /onlineMethods\.has\(paymentMethod\) \? readIntegrationConfig\(\) : Promise\.resolve\(null\)/);
});

test("công tắc không chặn IPN, đối soát hoặc hoàn tiền của đơn ZaloPay cũ", () => {
  for (const source of [ipnRoute, confirmation, reservation, refundService]) {
    assert.doesNotMatch(source, /zalopay\.enabled/);
  }
  assert.match(ipnRoute, /markVerifiedPayment\(orderCode/);
  assert.match(confirmation, /syncVerifiedOrderToPos/);
  assert.match(reservation, /reconcilePendingZaloPayPayments/);
  assert.match(refundService, /refundZaloPayPayment/);
});
