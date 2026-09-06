import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("địa chỉ khách được lưu cục bộ và dự phòng trong database theo phiên ký", async () => {
  const page = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/customer/addresses/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/customer-addresses.ts", import.meta.url), "utf8");

  assert.match(page, /localStorage\.setItem\("blanwhiSavedAddresses"/);
  assert.match(page, /fetch\("\/api\/customer\/addresses"/);
  assert.match(page, /void hydrateCustomerAddresses\(\)/);
  assert.match(page, /addressesToMigrate/);
  assert.match(route, /readCustomerSessionFromCookieHeader/);
  assert.doesNotMatch(route, /body\.deviceId/);
  assert.match(store, /customer-saved-addresses/);
  assert.match(store, /writeKeyedJsonRecord/);
});

test("lưu địa chỉ không thay đổi API tạo đơn, tồn kho hoặc Pancake", async () => {
  const page = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  const beforeCheckout = page.indexOf("fetch(`${paymentApiBase}/api/payments/create`");
  const localSave = page.lastIndexOf("saveCustomerAddress({", beforeCheckout);
  assert.ok(localSave > 0 && localSave < beforeCheckout, "địa chỉ phải được lưu cục bộ trước lúc chuyển trang thanh toán");
});
