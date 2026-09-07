import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { carrierHasAcceptedCustomerOrder } from "../lib/order-state.ts";

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
const cancelSource = extractFunction(customerPage, "cancelCustomerOrder");
const context = { customerOrderStep: () => 0 };
vm.createContext(context);
vm.runInContext(`${lockedSource}; ${canCancelSource}; ${mergeSource}; this.locked = customerCancellationLocked; this.canCancel = canCustomerCancel; this.merge = mergeCustomerOrderFromServer;`, context);

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
