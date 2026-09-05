import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const createRoute = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
const ipnRoute = await readFile(new URL("../app/api/payments/zalopay-ipn/route.ts", import.meta.url), "utf8");
const paymentResult = await readFile(new URL("../app/payment-result/page.tsx", import.meta.url), "utf8");
const payment = await readFile(new URL("../lib/payment.ts", import.meta.url), "utf8");
const cancelRoute = await readFile(new URL("../app/api/orders/[code]/cancel/route.ts", import.meta.url), "utf8");
const queue = await readFile(new URL("../lib/pancake/queue-handler.ts", import.meta.url), "utf8");
const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

test("COD lưu database trước và Pancake lỗi được đưa vào hàng đợi", () => {
  assert.match(createRoute, /createReservedOrder\(\{ \.\.\.order, checkoutCompletedAt: now \}\)[\s\S]*?schedulePosSync\(order\)/);
  assert.match(createRoute, /Đã lưu đơn, chờ gửi Pancake/);
  assert.match(queue, /const attempts = job\.attempts \+ 1/);
  assert.match(queue, /Math\.min\(60, 2 \*\* attempts\) \* 60_000/);
});

test("ZaloPay lỗi hoặc treo có timeout và thông báo tường minh", () => {
  assert.match(payment, /async function fetchZaloPayJson/);
  assert.match(payment, /controller\.abort\(\), timeoutMs/);
  assert.match(payment, /phản hồi quá thời gian\. Vui lòng thử lại; hệ thống sẽ dùng mã giao dịch cũ để tránh tạo trùng đơn/);
  assert.match(customerPage, /checkoutController\.abort\(\), 25000/);
  assert.match(customerPage, /Kết nối đang chậm\. Vui lòng bấm Đặt hàng lại/);
});

test("redirect ZaloPay không thể tự đánh dấu paid nếu API ZaloPay chưa xác nhận", () => {
  assert.match(paymentResult, /reconcileReturnedZaloPayOrder/);
  assert.match(paymentResult, /reconcileZaloPayPayment/);
  assert.doesNotMatch(paymentResult, /ZaloPay redirect payment success/);
  assert.match(ipnRoute, /verifyZaloPayBody/);
  assert.match(ipnRoute, /order\.total !== amount/);
  assert.match(ipnRoute, /recordPaymentOrphan/);
});

test("hủy đơn lưu database trước khi gọi Pancake và vẫn retry khi POS lỗi", () => {
  const saveIndex = cancelRoute.indexOf("let cancelled = await updateOrder(code");
  const queueIndex = cancelRoute.indexOf('QueueHandler.enqueue("order.cancel"');
  assert.ok(saveIndex >= 0);
  assert.ok(queueIndex > saveIndex);
  assert.match(cancelRoute, /Website đã ghi nhận; yêu cầu hủy POS đang được tự động thử lại/);
});
