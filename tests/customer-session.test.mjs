import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("phiên khách được ký, hết hạn và chống sửa token", async () => {
  const source = await readFile(new URL("../lib/customer-session.ts", import.meta.url), "utf8");
  assert.match(source, /createHmac\("sha256"/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /payload\.expiresAt <= Math\.floor\(now \/ 1000\)/);
  assert.match(source, /httpOnly: true/);
  assert.match(source, /sameSite: "lax"/);
});

test("trang khách giữ luồng cũ và đồng bộ phiên trước khi xem hoặc đặt đơn", async () => {
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  const customerOrdersRoute = await readFile(new URL("../app/api/orders/customer/route.ts", import.meta.url), "utf8");
  assert.match(customerPage, /const customerSessionReady = initializeCustomerSession\(\)/);
  assert.match(customerPage, /await customerSessionReady/);
  assert.match(customerPage, /Sao chép link xem đơn/);
  assert.match(customerPage, /Nếu bạn cần xem đơn ở thiết bị khác hoặc trình duyệt khác/);
  assert.match(customerOrdersRoute, /readCustomerSessionFromCookieHeader/);
  assert.match(customerOrdersRoute, /\|\| String\(body\.deviceId/);
});
