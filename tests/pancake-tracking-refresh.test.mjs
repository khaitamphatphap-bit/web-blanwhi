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

test("mô phỏng 100 đơn từ lúc đặt đến khi trang khách nhận đủ mã vận đơn Pancake", async () => {
  const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
  assert.match(customerPage, /<strong>\$\{order\.trackingCode \|\| "Đang cập nhật"\}<\/strong>/);

  const database = new Map();
  const expectedTrackingByOrder = new Map();
  const carriers = ["SPX Express", "ViettelPost", "Giao Hàng Nhanh", "Giao Hàng Tiết Kiệm", "VNPost"];

  for (let index = 1; index <= 100; index += 1) {
    const orderCode = `BLW-TEST-${String(index).padStart(3, "0")}`;
    database.set(orderCode, {
      code: orderCode,
      status: "pending",
      paymentMethod: "cod",
      shippingStatus: "not_created",
      trackingCode: "",
      total: 1_500_000 + index,
      items: [{ name: `Sản phẩm test ${index}`, quantity: (index % 3) + 1 }]
    });
  }

  // Giả lập Pancake cấp mã theo 10 đợt, mỗi đợt 10 đơn.
  for (let batchStart = 1; batchStart <= 100; batchStart += 10) {
    for (let index = batchStart; index < batchStart + 10; index += 1) {
      const orderCode = `BLW-TEST-${String(index).padStart(3, "0")}`;
      const carrierIndex = (index - 1) % carriers.length;
      const serial = String(index).padStart(12, "0");
      const trackingCode = [
        `SPXVN${serial}`,
        `VTP${serial}`,
        `GHN${serial}`,
        `GHTK${serial}`,
        `VNPOST${serial}`
      ][carrierIndex];
      const payload = [
        { data: { partner: { partner_name: "Shopee Express" }, shipment: { tracking_code: trackingCode } } },
        { DATA: { partner_name: "Viettel Post", ORDER_NUMBER: trackingCode } },
        { tracking_lookup: { carrier_name: "GHN", tracking_url: `https://tracking.example/?tracking_no=${trackingCode}` } },
        { result: { shipping_partner: "GHTK", logistics: { waybill_code: trackingCode } } },
        { data: { carrier_name: "VN Post", shipment: { label_id: trackingCode } } }
      ][carrierIndex];
      const current = database.get(orderCode);
      const patch = buildTrackingOnlyPatch(current, extractPancakeTracking(payload));
      assert.ok(patch, `${orderCode} phải nhận được bản vá mã vận đơn`);
      database.set(orderCode, { ...current, ...patch });
      expectedTrackingByOrder.set(orderCode, trackingCode);
    }
  }

  const customerOrders = Array.from(database.values());
  assert.equal(customerOrders.length, 100);
  assert.equal(new Set(customerOrders.map((order) => order.code)).size, 100);
  assert.equal(new Set(customerOrders.map((order) => order.trackingCode)).size, 100);
  assert.equal(customerOrders.filter((order) => !order.trackingCode).length, 0);

  for (const order of customerOrders) {
    assert.equal(order.trackingCode, expectedTrackingByOrder.get(order.code), `${order.code} không được gắn nhầm mã`);
    assert.equal(order.shippingStatus, "ready_to_ship");
    assert.equal(order.shippingCarrier, carriers[(Number(order.code.slice(-3)) - 1) % carriers.length]);
    assert.equal(order.status, "pending");
    assert.equal(order.paymentMethod, "cod");
    assert.equal(order.items.length, 1);
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
