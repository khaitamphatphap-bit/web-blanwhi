import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTrackingOnlyPatch, extractPancakeTracking } from "../lib/pancake/tracking.ts";

test("đọc mã vận đơn SPX từ dữ liệu lồng nhau của Pancake", () => {
  const snapshot = extractPancakeTracking({
    data: { partner: { partner_name: "Shopee Express" }, shipment: { tracking_code: "spxvn123456789012" } }
  });
  assert.equal(snapshot.trackingCode, "SPXVN123456789012");
  assert.equal(snapshot.carrier, "SPX Express");
});

test("đọc mã ViettelPost và mã nằm trong tracking URL", () => {
  const viettel = extractPancakeTracking({ DATA: { ORDER_NUMBER: "VTP123456789", partner_name: "Viettel Post" } });
  assert.equal(viettel.trackingCode, "VTP123456789");
  assert.equal(viettel.carrier, "ViettelPost");

  const fromUrl = extractPancakeTracking({ data: { tracking_url: "https://spx.vn/track?tracking_code=SPXVN998877665544" } });
  assert.equal(fromUrl.trackingCode, "SPXVN998877665544");
  assert.equal(fromUrl.carrier, "SPX Express");
});

test("không nhận mã website hoặc UUID làm mã vận đơn", () => {
  assert.equal(extractPancakeTracking({ tracking_code: "BLW-260905000000-AAAA" }).trackingCode, "");
  assert.equal(extractPancakeTracking({ tracking_code: "123e4567-e89b-12d3-a456-426614174000" }).trackingCode, "");
});

test("bản vá tracking không xóa mã cũ và không làm lùi trạng thái", () => {
  assert.equal(buildTrackingOnlyPatch({ trackingCode: "SPXVNOLD123456", shippingStatus: "shipping" }, extractPancakeTracking({})), null);
  const patch = buildTrackingOnlyPatch(
    { shippingStatus: "shipping", shippingCarrier: "SPX Express" },
    extractPancakeTracking({ tracking_code: "SPXVNNEW123456", shipping_status: "ready_to_ship" })
  );
  assert.equal(patch?.trackingCode, "SPXVNNEW123456");
  assert.equal(patch?.shippingStatus, "shipping");
  assert.deepEqual(Object.keys(patch || {}).sort(), ["shippingCarrier", "shippingMessage", "shippingStatus", "trackingCode"].sort());
  const cancelledPayload = buildTrackingOnlyPatch(
    { shippingStatus: "not_created" },
    extractPancakeTracking({ tracking_code: "SPXVNSTABLE1234", shipping_status: "cancelled" })
  );
  assert.equal(cancelledPayload?.shippingStatus, "ready_to_ship");
});

test("20 lần mã xuất hiện chậm đều được đọc đúng và chỉ tạo bản vá vận chuyển", () => {
  for (let index = 1; index <= 20; index += 1) {
    assert.equal(buildTrackingOnlyPatch({ shippingStatus: "not_created" }, extractPancakeTracking({ data: { system_id: index } })), null);
    const code = `SPXVN${String(index).padStart(12, "0")}`;
    const patch = buildTrackingOnlyPatch(
      { shippingStatus: "not_created" },
      extractPancakeTracking({ tracking_lookup: { url: `https://spx.vn/track?tracking_code=${code}` } })
    );
    assert.equal(patch?.trackingCode, code);
    assert.equal(patch?.shippingStatus, "ready_to_ship");
  }
});

test("webhook, trang khách và cron đều nối vào đồng bộ tracking chuyên biệt", async () => {
  const webhook = await readFile(new URL("../app/api/webhooks/pancake/route.ts", import.meta.url), "utf8");
  const orders = await readFile(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
  const customer = await readFile(new URL("../app/api/orders/customer/route.ts", import.meta.url), "utf8");
  const lookup = await readFile(new URL("../app/api/orders/lookup/route.ts", import.meta.url), "utf8");
  const cron = await readFile(new URL("../app/api/admin/orders/shipping-sync/route.ts", import.meta.url), "utf8");
  assert.match(webhook, /after[\s\S]*refreshMissingPancakeTracking/);
  assert.match(orders, /refreshMissingPancakeTracking/);
  assert.match(customer, /refreshMissingPancakeTracking/);
  assert.match(lookup, /refreshMissingPancakeTracking/);
  assert.match(cron, /refreshMissingPancakeTracking/);
});
