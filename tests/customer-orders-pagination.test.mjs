import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Đơn hàng của tôi phân trang để không mất đơn sau mốc 100", async () => {
  const route = await readFile(new URL("../app/api/orders/customer/route.ts", import.meta.url), "utf8");
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

  assert.match(route, /slice\(0, 500\)/);
  assert.match(route, /matched\.slice\(offset, offset \+ limit\)/);
  assert.match(route, /hasMore: offset \+ refreshed\.length < matched\.length/);
  assert.match(customerPage, /for \(let offset = 0; offset < 500; offset \+= 100\)/);
  assert.match(customerPage, /codes\.slice\(index, index \+ 100\)/);
});
