import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ordersSource = await readFile(new URL("../lib/orders.ts", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/api/orders/route.ts", import.meta.url), "utf8");
const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

test("refundStatus not_required không được biến đơn mới thành đơn hủy", () => {
  assert.doesNotMatch(ordersSource, /Boolean\(normalizedOrder\.refundStatus\)/);
  assert.match(ordersSource, /normalizedOrder\.pancakeStatus === "cancelled"/);
});

test("API trạng thái luôn trả giá trị vận chuyển rõ ràng", () => {
  assert.match(apiSource, /trackingCode: order\.trackingCode \|\| ""/);
  assert.match(apiSource, /shippingStatus: order\.shippingStatus \|\| "not_created"/);
  assert.match(apiSource, /pancakeStatus: order\.pancakeStatus \|\| null/);
});

test("trang khách dùng trạng thái server, không giữ trạng thái hủy cũ trên thiết bị", () => {
  assert.doesNotMatch(customerPage, /order\.status === "Đơn hủy" \|\| serverOrder\.status === "cancelled"/);
  assert.match(customerPage, /serverOrder\.status === "cancelled" \? "Đơn hủy" : serverOrder\.paymentMethod === "cod" \? "Chờ vận chuyển" : "Chờ thanh toán"/);
  assert.match(customerPage, /rawStatus: serverOrder\.status,/);
  assert.match(customerPage, /transactionId: serverOrder\.transactionId \|\| ""/);
  assert.match(customerPage, /shippingMessage: serverOrder\.shippingMessage \|\| ""/);
});

test("mã vận đơn được ưu tiên hơn nhãn đóng gói Pancake", () => {
  const trackingPriority = customerPage.indexOf("if (hasTrackingCode) return customerShippingLabels.ready_to_ship;");
  const pancakeFallback = customerPage.indexOf("if (order.pancakeStatus && customerPancakeLabels[order.pancakeStatus])");
  assert.ok(trackingPriority >= 0);
  assert.ok(pancakeFallback > trackingPriority);
});

test("hiển thị đúng nhiều trạng thái đơn khác nhau ở trang khách", () => {
  const functionSource = customerPage.match(/function customerOrderStatus\(order\) \{[\s\S]*?\n      \}\n\n      function canCustomerCancel/)?.[0]
    .replace(/\n\n      function canCustomerCancel[\s\S]*$/, "");
  assert.ok(functionSource);
  const context = {
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
  vm.runInContext(`${functionSource}; this.customerOrderStatus = customerOrderStatus;`, context);

  const orders = [
    { rawStatus: "pending", status: "Chờ vận chuyển", paymentMethod: "cod", shippingStatus: "not_created", refundStatus: "not_required" },
    { rawStatus: "pending", status: "Chờ vận chuyển", paymentMethod: "cod", shippingStatus: "not_created", pancakeStatus: "packing", trackingCode: "SPXVN123" },
    { rawStatus: "pending", status: "Chờ vận chuyển", paymentMethod: "cod", shippingStatus: "shipping", trackingCode: "VTP123" },
    { rawStatus: "paid", status: "Đã thanh toán", paymentMethod: "zalopay", shippingStatus: "delivered", trackingCode: "SPXVN456" },
    { rawStatus: "cancelled", status: "Đơn hủy", paymentMethod: "cod", shippingStatus: "cancelled" }
  ];
  assert.deepEqual(orders.map(context.customerOrderStatus), [
    "Chờ vận chuyển",
    "Đã giao cho đơn vị vận chuyển",
    "Đang giao hàng",
    "Đã giao hàng cho khách",
    "Đơn hủy"
  ]);
});
