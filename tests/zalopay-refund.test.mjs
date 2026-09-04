import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildZaloPayRefundRequestId } from "../lib/zalopay-refund-id.ts";

const order = {
  code: "BLW-260904-REFUND-TEST",
  createdAt: "2026-09-04T00:00:00.000Z"
};

test("mã yêu cầu hoàn ZaloPay ổn định để retry không hoàn hai lần", () => {
  const first = buildZaloPayRefundRequestId(order, "2553", new Date("2026-09-04T01:00:00.000Z"));
  const second = buildZaloPayRefundRequestId(order, "2553", new Date("2026-09-04T10:00:00.000Z"));
  assert.equal(first, second);
  assert.match(first, /^260904_2553_[a-f0-9]{16}$/);
  assert.ok(first.length <= 45);
});

test("luôn dùng lại mã hoàn tiền đã lưu", () => {
  const saved = "260904_2553_savedrefund";
  assert.equal(buildZaloPayRefundRequestId({ ...order, refundTransactionId: saved }, "2553"), saved);
});

test("route huỷ đơn khách gọi API hoàn tiền tự động", async () => {
  const source = await readFile(new URL("../app/api/orders/[code]/cancel/route.ts", import.meta.url), "utf8");
  assert.match(source, /requestAutomaticZaloPayRefund\(cancelled, config, reason\)/);
  assert.match(source, /Liên hệ Zalo 0866561480 để được hỗ trợ thêm/);
});

test("dịch vụ hoàn tiền gọi ZaloPay và admin có route thử lại", async () => {
  const service = await readFile(new URL("../lib/zalopay-refund-service.ts", import.meta.url), "utf8");
  const adminRoute = await readFile(new URL("../app/api/admin/orders/[code]/refund/route.ts", import.meta.url), "utf8");
  assert.match(service, /refundZaloPayPayment\(current, config\.payment, reason\)/);
  assert.match(adminRoute, /requestAutomaticZaloPayRefund\(order, await readIntegrationConfig\(\)/);
});
