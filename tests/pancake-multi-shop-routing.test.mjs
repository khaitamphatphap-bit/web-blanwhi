import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  defaultPancakeRoutingState,
  pancakeConnectionForOrder,
  pancakeConnectionForQueue,
  stampPancakeConnection
} from "../lib/pancake/connection-routing.ts";

const dashboardRoute = await readFile(new URL("../app/api/admin/pancake/route.ts", import.meta.url), "utf8");
const dashboardUi = await readFile(new URL("../app/admin/pancake/pancake-admin.tsx", import.meta.url), "utf8");
const orderSync = await readFile(new URL("../lib/pancake/order-sync-service.ts", import.meta.url), "utf8");
const webhook = await readFile(new URL("../app/api/webhooks/pancake/route.ts", import.meta.url), "utf8");
const shop2Webhook = await readFile(new URL("../app/api/webhooks/pancake/shop-2/route.ts", import.meta.url), "utf8");
const checkout = await readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../lib/order-background-jobs.ts", import.meta.url), "utf8");
const productLinks = await readFile(new URL("../lib/pancake/connection-product-links.ts", import.meta.url), "utf8");
const productLinkService = await readFile(new URL("../lib/pancake/product-link-service.ts", import.meta.url), "utf8");
const inventoryService = await readFile(new URL("../lib/pancake/inventory-service.ts", import.meta.url), "utf8");
const pollRoute = await readFile(new URL("../app/api/admin/pancake/poll/route.ts", import.meta.url), "utf8");
const availabilityRoute = await readFile(new URL("../app/api/inventory/availability/route.ts", import.meta.url), "utf8");
const trackingRefresh = await readFile(new URL("../lib/pancake/tracking-refresh.ts", import.meta.url), "utf8");
const customerPaymentStatus = await readFile(new URL("../lib/customer-payment-status.ts", import.meta.url), "utf8");
const adminOrders = await readFile(new URL("../lib/admin-orders.ts", import.meta.url), "utf8");
const shippingSync = await readFile(new URL("../app/api/admin/orders/shipping-sync/route.ts", import.meta.url), "utf8");
const adminOrderSync = await readFile(new URL("../app/api/admin/orders/[code]/sync/route.ts", import.meta.url), "utf8");
const adminOrderShipping = await readFile(new URL("../app/api/admin/orders/[code]/shipping/route.ts", import.meta.url), "utf8");

function order(code, pancakeConnectionId) {
  return {
    id: code,
    code,
    ...(pancakeConnectionId ? { pancakeConnectionId } : {}),
    status: "pending",
    paymentMethod: "cod",
    paymentProvider: "cod",
    customer: { name: "Test", phone: "0900000000", address: "Test" },
    items: [], subtotal: 0, discount: 0, shipping: 0, total: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

test("mọi đơn cũ không có nhãn kết nối vẫn luôn thuộc Shop 1", () => {
  for (let index = 0; index < 2000; index += 1) {
    assert.equal(pancakeConnectionForOrder(order(`OLD-${index}`)), "shop-1");
  }
});

test("chuyển Shop 2 chỉ đóng dấu cho đơn mới và không sửa đơn cũ", () => {
  const oldOrder = order("OLD-1", "shop-1");
  const state = { ...defaultPancakeRoutingState, activeNewOrders: "shop-2" };
  const newOrder = stampPancakeConnection(order("NEW-1"), state);
  assert.equal(pancakeConnectionForOrder(oldOrder), "shop-1");
  assert.equal(pancakeConnectionForOrder(newOrder), "shop-2");
  assert.equal(stampPancakeConnection(oldOrder, state), oldOrder);
});

test("tác vụ cũ mặc định Shop 1 và tác vụ mới giữ nguyên shop đã chốt", () => {
  assert.equal(pancakeConnectionForQueue({ payload: { orderCode: "OLD" } }), "shop-1");
  assert.equal(pancakeConnectionForQueue({ payload: { orderCode: "NEW", pancakeConnectionId: "shop-2" } }), "shop-2");
  assert.equal(pancakeConnectionForQueue({ payload: { orderCode: "NEW" } }, order("NEW", "shop-2")), "shop-2");
});

test("giao diện nói rõ chỉ ngừng đơn mới và khóa Shop 2 chưa sẵn sàng", () => {
  assert.match(dashboardUi, /Ngừng nhận đơn mới không ngắt kết nối/);
  assert.match(dashboardUi, /Duy trì đơn cũ:<\/strong> Luôn bật/);
  assert.match(dashboardUi, /Chưa đủ điều kiện nhận đơn/);
  assert.match(dashboardRoute, /setActivePancakeConnection/);
});

test("phần thêm Shop 2 không sửa luồng Shop 1 hiện tại", () => {
  assert.doesNotMatch(orderSync, /shop-2|PANCAKE2/);
  assert.doesNotMatch(webhook, /shop-2|PANCAKE2/);
});

test("checkout đóng dấu shop một lần và hàng đợi giữ đúng shop đích", () => {
  assert.match(checkout, /stampPancakeConnection\(order, pancakeRouting\)/);
  assert.match(checkout, /pancakeConnectionId: order\.pancakeConnectionId \|\| "shop-1"/);
  assert.match(worker, /connectionId !== pancakeConnectionForOrder\(order\)/);
  assert.match(worker, /new PancakeService\(connectionId\)/);
});

test("Shop 2 có webhook riêng và không dùng nhầm secret Shop 1", () => {
  assert.match(shop2Webhook, /new WebhookController\("shop-2"\)/);
  assert.match(shop2Webhook, /new PancakeService\("shop-2"\)/);
  assert.match(orderSync, /PANCAKE_CONNECTION_MISMATCH/);
});

test("checkout chọn cấu hình và ánh xạ SKU đúng shop trước khi lưu database", () => {
  assert.match(checkout, /connectionConfigured\(pancakeConnection\(pancakeRouting\.activeNewOrders\)\)/);
  assert.match(checkout, /stampPancakeConnection\(order, pancakeRouting\)/);
  assert.match(checkout, /applyConnectionProductLinks\(order, order\.pancakeConnectionId \|\| "shop-1"\)/);
  assert.match(checkout, /createReservedOrder/);
  assert.match(checkout, /queuePosSync\(order\)/);
});

test("Shop 2 có kho ánh xạ sản phẩm riêng và không ghi đè liên kết Shop 1", () => {
  assert.match(productLinks, /pancake-links-shop-2\.json/);
  assert.match(productLinks, /if \(id === "shop-1"\) return writePancakeProductLink/);
  assert.match(productLinks, /delete next\[key\]/);
  assert.match(dashboardRoute, /new ProductLinkService\(selectedPancake\)/);
  assert.doesNotMatch(dashboardRoute, /new InventoryService\(selectedPancake\)\.sync\(\)/);
  assert.match(productLinkService, /websiteSkuCount\.get\(sku\) === 1 && candidates\.length === 1/);
});

test("website và Pancake không đồng bộ số lượng qua lại", () => {
  assert.match(inventoryService, /mode: "independent"/);
  assert.match(inventoryService, /const variations:[^=]+ = \[\]/);
  assert.match(pollRoute, /mode: "independent", skipped: true/);
  assert.doesNotMatch(pollRoute, /new InventoryService\(\)\.sync\(\)/);
  assert.match(availabilityRoute, /service\.availability\(productId, false\)/);
  assert.doesNotMatch(availabilityRoute, /refreshPancake/);
});

test("mọi đường xem và đối soát phụ đều dùng shop đã đóng dấu trên đơn", () => {
  assert.match(trackingRefresh, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
  assert.match(customerPaymentStatus, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
  assert.match(adminOrders, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
  assert.match(shippingSync, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
  assert.match(shippingSync, /\["shop-1", "shop-2"\][\s\S]*?pollStatuses/);
  assert.match(adminOrderSync, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
  assert.match(adminOrderShipping, /new PancakeService\(pancakeConnectionForOrder\(order\)\)/);
});

test("mô phỏng 5000 đơn chuyển Shop 1 và Shop 2 vẫn lưu đủ, không gửi nhầm hoặc ghi đè", () => {
  const database = new Map();
  const outbox = [];
  const remote = { "shop-1": new Map(), "shop-2": new Map() };
  const events = [];
  let state = structuredClone(defaultPancakeRoutingState);
  state.productSync["shop-2"] = { status: "ready", linkedCount: 303, totalCount: 303 };

  function place(index) {
    const code = `SIM-${String(index).padStart(5, "0")}`;
    const stamped = stampPancakeConnection(order(code), state);
    assert.equal(database.has(code), false);
    database.set(code, structuredClone(stamped));
    events.push(`db:${code}`);
    outbox.push({ id: `job-${code}`, type: "order.create", payload: { orderCode: code, pancakeConnectionId: stamped.pancakeConnectionId } });
    events.push(`queue:${code}`);
    return stamped;
  }

  for (let index = 0; index < 5000; index += 1) {
    if (index % 37 === 0) state = { ...state, activeNewOrders: state.activeNewOrders === "shop-1" ? "shop-2" : "shop-1" };
    const saved = place(index);
    assert.equal(events.at(-2), `db:${saved.code}`);
    assert.equal(events.at(-1), `queue:${saved.code}`);
  }

  for (const job of outbox) {
    const saved = database.get(job.payload.orderCode);
    const target = pancakeConnectionForQueue(job, saved);
    assert.equal(target, pancakeConnectionForOrder(saved));
    if (!remote[target].has(saved.code)) remote[target].set(saved.code, structuredClone(saved));
    // Retry cùng tác vụ phải idempotent và không tạo bản thứ hai.
    if (!remote[target].has(saved.code)) remote[target].set(saved.code, structuredClone(saved));
  }

  assert.equal(database.size, 5000);
  assert.equal(outbox.length, 5000);
  assert.equal(remote["shop-1"].size + remote["shop-2"].size, 5000);
  assert.equal([...database.values()].filter((saved) => saved.pancakeConnectionId === "shop-1").length, remote["shop-1"].size);
  assert.equal([...database.values()].filter((saved) => saved.pancakeConnectionId === "shop-2").length, remote["shop-2"].size);
});

test("mô phỏng retry, hủy và webhook không được đổi shop của đơn", () => {
  for (const target of ["shop-1", "shop-2"]) {
    const state = { ...defaultPancakeRoutingState, activeNewOrders: target };
    const saved = stampPancakeConnection(order(`FLOW-${target}`), state);
    const createJob = { payload: { orderCode: saved.code, pancakeConnectionId: target } };
    const cancelJob = { payload: { orderCode: saved.code, pancakeConnectionId: target } };
    assert.equal(pancakeConnectionForQueue(createJob, saved), target);
    assert.equal(pancakeConnectionForQueue(cancelJob, saved), target);
    const wrong = target === "shop-1" ? "shop-2" : "shop-1";
    assert.notEqual(pancakeConnectionForQueue({ payload: { orderCode: saved.code, pancakeConnectionId: wrong } }, saved), pancakeConnectionForOrder(saved));
  }
  assert.match(worker, /connectionId !== pancakeConnectionForOrder\(order\)/);
  assert.match(orderSync, /this\.owns\(candidate\)/);
  assert.match(orderSync, /PANCAKE_CONNECTION_MISMATCH/);
});

test("5000 đơn chỉ trừ tồn đúng một Pancake đang chọn, shop còn lại không đổi", () => {
  const database = new Map();
  const outbox = [];
  const apiCalls = { "shop-1": [], "shop-2": [] };
  const remoteStock = {
    "shop-1": new Map(Array.from({ length: 25 }, (_, index) => [`SKU-${index}`, 20_000])),
    "shop-2": new Map(Array.from({ length: 25 }, (_, index) => [`SKU-${index}`, 20_000]))
  };
  const remoteOrders = { "shop-1": new Set(), "shop-2": new Set() };
  let state = structuredClone(defaultPancakeRoutingState);
  state.productSync["shop-2"] = { status: "ready", linkedCount: 303, totalCount: 303 };

  for (let index = 0; index < 5000; index += 1) {
    if (index % 13 === 0) state = { ...state, activeNewOrders: state.activeNewOrders === "shop-1" ? "shop-2" : "shop-1" };
    const sku = `SKU-${index % 25}`;
    const quantity = index % 3 + 1;
    const saved = stampPancakeConnection({ ...order(`STOCK-${index}`), items: [{ sku, quantity }] }, state);
    database.set(saved.code, structuredClone(saved));
    outbox.push({ payload: { orderCode: saved.code, pancakeConnectionId: saved.pancakeConnectionId } });
  }

  for (const job of outbox) {
    const saved = database.get(job.payload.orderCode);
    const target = pancakeConnectionForQueue(job, saved);
    const inactive = target === "shop-1" ? "shop-2" : "shop-1";
    const item = saved.items[0];
    const inactiveBefore = remoteStock[inactive].get(item.sku);
    if (!remoteOrders[target].has(saved.code)) {
      remoteOrders[target].add(saved.code);
      remoteStock[target].set(item.sku, remoteStock[target].get(item.sku) - item.quantity);
      apiCalls[target].push(saved.code);
    }
    // Retry cùng đơn không trừ lần hai và không gọi shop còn lại.
    if (!remoteOrders[target].has(saved.code)) throw new Error("Idempotency simulation failed");
    assert.equal(remoteStock[inactive].get(item.sku), inactiveBefore);
    assert.equal(remoteOrders[inactive].has(saved.code), false);
  }

  assert.equal(database.size, 5000);
  assert.equal(outbox.length, 5000);
  assert.equal(apiCalls["shop-1"].length + apiCalls["shop-2"].length, 5000);
  assert.equal(remoteOrders["shop-1"].size + remoteOrders["shop-2"].size, 5000);
  for (const saved of database.values()) {
    const target = saved.pancakeConnectionId;
    const inactive = target === "shop-1" ? "shop-2" : "shop-1";
    assert.equal(remoteOrders[target].has(saved.code), true);
    assert.equal(remoteOrders[inactive].has(saved.code), false);
  }
});
