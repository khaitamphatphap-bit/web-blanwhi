import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { carrierHasAcceptedCustomerOrder } from "../lib/order-state.ts";
import { buildTrackingOnlyPatch, extractPancakeTracking } from "../lib/pancake/tracking.ts";

const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");
const cancellationApi = await readFile(new URL("../app/api/orders/[code]/cancel/route.ts", import.meta.url), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `không tìm thấy hàm ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`hàm ${name} không đóng ngoặc`);
}

const lockedSource = extractFunction(customerPage, "customerCancellationLocked");
const canCancelSource = extractFunction(customerPage, "canCustomerCancel");
const mergeSource = extractFunction(customerPage, "mergeCustomerOrderFromServer");
const statusSource = extractFunction(customerPage, "customerOrderStatus");
const cancelSource = extractFunction(customerPage, "cancelCustomerOrder");
const context = {
  customerOrderStep: () => 0,
  customerShippingLabels: {
    not_created: "Đơn mới đặt",
    ready_to_ship: "Đã giao cho đơn vị vận chuyển",
    shipping: "Đang giao hàng",
    delivered: "Đã giao hàng cho khách",
    cancelled: "Đơn hủy",
    unknown: "Đang cập nhật"
  },
  customerPancakeLabels: { packing: "Đóng gói", shipping: "Đang giao" }
};
vm.createContext(context);
vm.runInContext(`${lockedSource}; ${canCancelSource}; ${mergeSource}; ${statusSource}; this.locked = customerCancellationLocked; this.canCancel = canCustomerCancel; this.merge = mergeCustomerOrderFromServer; this.customerStatus = customerOrderStatus;`, context);

test("đơn có mã vận đơn hiện nút hủy bị khóa và lời hướng dẫn", () => {
  assert.match(customerPage, /order-cancel order-cancel-locked[^>]*disabled>Hủy đơn<\/button>/);
  assert.match(customerPage, /Đơn hàng đã gửi đi, vui lòng liên hệ shop để huỷ đơn\./);
  assert.match(customerPage, /order-cancel\.order-cancel-locked[\s\S]*cursor: not-allowed/);
});

test("không ghi trạng thái hủy giả trước khi API và database xác nhận", () => {
  const requestStart = cancelSource.indexOf("let response = await requestOrderCancellation");
  assert.ok(requestStart > 0);
  const beforeRequest = cancelSource.slice(0, requestStart);
  assert.doesNotMatch(beforeRequest, /rawStatus:\s*"cancelled"/);
  assert.doesNotMatch(beforeRequest, /status:\s*"Đơn hủy"/);
  assert.doesNotMatch(beforeRequest, /shippingStatus:\s*"cancelled"/);
  assert.doesNotMatch(beforeRequest, /saveOrders\(|replaceCustomerOrderSnapshot\(/);
  assert.match(cancelSource, /serverOrder\?\.status !== "cancelled" && serverOrder\?\.shippingStatus !== "cancelled"/);
  assert.match(cancelSource, /cancellationError\.order = result\.order \|\| null/);
  assert.match(cancelSource, /const serverOrder = error\.order \|\| await fetchServerOrderByCode\(code\)/);
  assert.match(cancellationApi, /carrierHasAcceptedCustomerOrder\(current\)[\s\S]*order: current[\s\S]*status: 409/);
});

test("mô phỏng 1000 đơn: mọi đơn đã bàn giao đều không thể bấm hủy", () => {
  const scenarios = [
    { shippingStatus: "not_created", trackingCode: "", pancakeStatus: "packing", cancellable: true },
    { shippingStatus: "ready_to_ship", trackingCode: "SPX001", pancakeStatus: "packing" },
    { shippingStatus: "shipping", trackingCode: "", pancakeStatus: "shipping" },
    { shippingStatus: "delivered", trackingCode: "SPX002", pancakeStatus: "completed" },
    { shippingStatus: "returning", trackingCode: "VTP003", pancakeStatus: "returned" },
    { shippingStatus: "returned", trackingCode: "", pancakeStatus: "returned" },
    { shippingStatus: "not_created", trackingCode: "", pancakeStatus: "shipping" },
    { shippingStatus: "ready_to_ship", trackingCode: "", pancakeStatus: "packing", cancellable: true }
  ];

  for (let index = 0; index < 1000; index += 1) {
    const scenario = scenarios[index % scenarios.length];
    const order = { rawStatus: "pending", status: "Chờ vận chuyển", ...scenario };
    const serverBlocksCancellation = carrierHasAcceptedCustomerOrder(order);
    if (serverBlocksCancellation || order.trackingCode || ["shipping", "completed", "returned"].includes(order.pancakeStatus)) {
      assert.equal(context.locked(order), true, `đơn ${index + 1} phải khóa nút hủy`);
      assert.equal(context.canCancel(order), false, `đơn ${index + 1} không được gửi yêu cầu hủy`);
    } else {
      assert.equal(context.canCancel(order), scenario.cancellable, `đơn ${index + 1} phải còn được hủy`);
    }
  }
});

test("mô phỏng 1000 phản hồi lỗi: trạng thái server thay thế hoàn toàn trạng thái hủy giả cũ", () => {
  for (let index = 0; index < 1000; index += 1) {
    const fallback = {
      code: `BLW-STALE-${index + 1}`,
      rawStatus: "cancelled",
      status: "Đơn hủy",
      paymentMethod: "cod",
      trackingCode: "",
      shippingStatus: "cancelled",
      pancakeStatus: "cancelled",
      updatedAt: "cũ"
    };
    const authoritative = {
      code: fallback.code,
      status: "pending",
      paymentMethod: "cod",
      trackingCode: `SPX-${index + 1}`,
      shippingStatus: index % 2 ? "ready_to_ship" : "shipping",
      pancakeStatus: "shipping",
      updatedAt: "2026-09-07T00:00:00.000Z"
    };
    const merged = context.merge(authoritative, fallback);
    assert.equal(merged.rawStatus, "pending");
    assert.equal(merged.status, "Chờ vận chuyển");
    assert.equal(merged.shippingStatus, authoritative.shippingStatus);
    assert.equal(merged.trackingCode, authoritative.trackingCode);
    assert.notEqual(merged.status, "Đơn hủy");
    assert.equal(context.canCancel(merged), false);
  }
});

test("mô phỏng 1000 lần hủy thành công: chỉ phản hồi server cancelled mới hiện đơn hủy", () => {
  for (let index = 0; index < 1000; index += 1) {
    const previous = {
      code: `BLW-CANCEL-${index + 1}`,
      rawStatus: "pending",
      status: "Chờ vận chuyển",
      paymentMethod: "cod",
      trackingCode: "",
      shippingStatus: "not_created",
      pancakeStatus: "packing"
    };
    const confirmed = context.merge({
      code: previous.code,
      status: "cancelled",
      paymentMethod: "cod",
      trackingCode: "",
      shippingStatus: "cancelled",
      pancakeStatus: index % 3 ? "cancelled" : "packing"
    }, previous);
    assert.equal(confirmed.rawStatus, "cancelled");
    assert.equal(confirmed.status, "Đơn hủy");
    assert.equal(confirmed.shippingStatus, "cancelled");
    assert.equal(context.canCancel(confirmed), false);
  }
});

test("flow 1000 đơn: Pancake cấp mã, trang khách thấy đúng mã và khóa hủy trước khi gửi API", () => {
  assert.match(customerPage, /<strong>\$\{order\.trackingCode \|\| "Đang cập nhật"\}<\/strong>/);
  const seenTrackingCodes = new Set();

  for (let index = 1; index <= 1000; index += 1) {
    const serial = String(index).padStart(12, "0");
    const variants = [
      {
        trackingCode: `SPXVN${serial}`,
        carrier: "SPX Express",
        payload: { data: { partner: { partner_name: "Shopee Express" }, shipment: { tracking_code: `SPXVN${serial}` } } }
      },
      {
        trackingCode: `VTP${serial}`,
        carrier: "ViettelPost",
        payload: { DATA: { partner_name: "Viettel Post", ORDER_NUMBER: `VTP${serial}` } }
      },
      {
        trackingCode: `GHN${serial}`,
        carrier: "Giao Hàng Nhanh",
        payload: { tracking_lookup: { carrier_name: "GHN", tracking_url: `https://tracking.example/?tracking_no=GHN${serial}` } }
      },
      {
        trackingCode: `GHTK${serial}`,
        carrier: "Giao Hàng Tiết Kiệm",
        payload: { result: { shipping_partner: "GHTK", logistics: { waybill_code: `GHTK${serial}` } } }
      },
      {
        trackingCode: `VNPOST${serial}`,
        carrier: "VNPost",
        payload: { data: { carrier_name: "VN Post", shipment: { label_id: `VNPOST${serial}` } } }
      }
    ];
    const variant = variants[(index - 1) % variants.length];
    const localOrder = {
      code: `BLW-FLOW-${String(index).padStart(4, "0")}`,
      rawStatus: "pending",
      status: "Chờ vận chuyển",
      paymentMethod: "cod",
      trackingCode: "",
      shippingStatus: "not_created",
      pancakeStatus: "packing",
      updatedAt: "2026-09-07T00:00:00.000Z"
    };

    assert.equal(context.canCancel(localOrder), true, `${localOrder.code} được phép hủy trước khi bàn giao`);
    for (let delayedAttempt = 0; delayedAttempt < index % 4; delayedAttempt += 1) {
      assert.equal(buildTrackingOnlyPatch(localOrder, extractPancakeTracking({ data: { system_id: `${index}-${delayedAttempt}` } })), null);
    }

    const trackingPatch = buildTrackingOnlyPatch(localOrder, extractPancakeTracking(variant.payload));
    assert.ok(trackingPatch, `${localOrder.code} phải nhận được mã Pancake`);
    const databaseOrder = { ...localOrder, ...trackingPatch };
    const customerOrder = context.merge({
      code: databaseOrder.code,
      status: "pending",
      paymentMethod: "cod",
      trackingCode: databaseOrder.trackingCode,
      shippingCarrier: databaseOrder.shippingCarrier,
      shippingStatus: databaseOrder.shippingStatus,
      shippingMessage: databaseOrder.shippingMessage,
      pancakeStatus: databaseOrder.pancakeStatus,
      updatedAt: "2026-09-07T00:01:00.000Z"
    }, localOrder);

    assert.equal(customerOrder.trackingCode, variant.trackingCode, `${localOrder.code} hiển thị đúng mã`);
    assert.equal(customerOrder.shippingCarrier, variant.carrier, `${localOrder.code} hiển thị đúng đơn vị vận chuyển`);
    assert.equal(context.customerStatus(customerOrder), "Đã giao cho đơn vị vận chuyển");
    assert.equal(carrierHasAcceptedCustomerOrder(customerOrder), true, `${localOrder.code} bị server chặn hủy`);
    assert.equal(context.locked(customerOrder), true, `${localOrder.code} hiện nút hủy khóa`);
    assert.equal(context.canCancel(customerOrder), false, `${localOrder.code} không được gọi API hủy`);

    let cancellationRequests = 0;
    if (context.canCancel(customerOrder)) cancellationRequests += 1;
    assert.equal(cancellationRequests, 0, `${localOrder.code} không phát sinh hủy giả`);
    assert.equal(customerOrder.rawStatus, "pending");
    assert.notEqual(customerOrder.status, "Đơn hủy");
    seenTrackingCodes.add(customerOrder.trackingCode);
  }

  assert.equal(seenTrackingCodes.size, 1000, "đủ 1000 đơn nhận mã riêng, không gắn nhầm hoặc mất mã");
});
