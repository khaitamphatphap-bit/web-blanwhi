import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("giỏ hàng được lưu ngay trên thiết bị và dự phòng theo phiên khách", async () => {
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/customer/cart/route.ts", import.meta.url), "utf8");

  assert.match(customerPage, /cartDraftStorageKey = "blanwhiCartDraftV1"/);
  assert.match(customerPage, /localStorage\.setItem\(cartDraftStorageKey/);
  assert.match(customerPage, /fetch\("\/api\/customer\/cart"/);
  assert.match(customerPage, /void restoreCartDraft\(\)/);
  assert.match(route, /readCustomerSessionFromCookieHeader/);
  assert.doesNotMatch(route, /body\.deviceId/);
});

test("khôi phục giỏ dùng catalog hiện tại và xóa bản nháp sau khi đơn đã lưu", async () => {
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

  assert.match(customerPage, /productData\.find\(\(item\) => item\.id === saved\.productId\)/);
  assert.match(customerPage, /amount,[\s\S]*?price: saved\.wholesale \?/);
  assert.match(customerPage, /const latestLocalDraft = readLocalCartDraft\(\);[\s\S]*?serverDraft\.updatedAt[\s\S]*?latestLocalDraft\?\.updatedAt/);
  assert.match(customerPage, /saveOrders\(\[order, \.\.\.loadOrders\(\)\]\);\s*await clearCartDraftAfterCheckout\(\)/);
  assert.match(customerPage, /cart\.length = 0;[\s\S]*?renderCart\(false\)/);
});

test("dữ liệu giỏ tạm có giới hạn, tự hết hạn và không ghi lịch sử đơn", async () => {
  const store = await readFile(new URL("../lib/data-store.ts", import.meta.url), "utf8");
  const drafts = await readFile(new URL("../lib/cart-drafts.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/customer/cart/route.ts", import.meta.url), "utf8");

  assert.match(store, /create table if not exists blanwhi_ephemeral_store/);
  assert.match(store, /expires_at > now\(\)/);
  assert.match(store, /make_interval\(secs => \$5::integer\)/);
  assert.match(drafts, /cartDraftTtlSeconds = 60 \* 60 \* 24 \* 30/);
  assert.match(drafts, /rawItems\.slice\(0, 60\)/);
  assert.match(route, /maxDraftRequestBytes = 64 \* 1024/);
});
