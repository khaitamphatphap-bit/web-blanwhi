import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminPaymentLabel,
  buildAdminOrderView,
  paginateAdminOrders
} from "../lib/admin-order-view.ts";

function order(overrides = {}) {
  const code = overrides.code || "BLW-260901155527-DS9X";
  return {
    id: code,
    code,
    status: "pending",
    paymentMethod: "zalopay",
    paymentProvider: "zalopay",
    customer: { name: "Khách test", phone: "0904496153", address: "Bắc Ninh" },
    items: [{ productId: "p-1", name: "Áo test", color: "Trắng", size: "L", quantity: 1, unitPrice: 762000 }],
    subtotal: 762000,
    discount: 0,
    shipping: 30000,
    total: 792000,
    shippingStatus: "not_created",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    ...overrides
  };
}

test("admin khôi phục đúng bản chốt và thanh toán ZaloPay từ lịch sử database", () => {
  const current = order();
  const history = order({
    status: "paid",
    transactionId: "260901004609905",
    paymentProviderOrderId: "260901_BLW-260901155527-DS9X",
    paymentVerificationStatus: "verified",
    subtotal: 677000,
    total: 707000,
    items: [{ productId: "p-1", name: "Áo test", color: "Trắng", size: "L", quantity: 1, unitPrice: 677000 }],
    createdAt: "2026-09-01T08:55:27.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z"
  });
  const before = JSON.stringify(current);
  const view = buildAdminOrderView(current, [history]);

  assert.equal(view.adminPaymentStatus, "paid");
  assert.equal(adminPaymentLabel(view), "Đã thanh toán");
  assert.equal(view.total, 707000);
  assert.equal(view.items[0].unitPrice, 677000);
  assert.equal(view.transactionId, "260901004609905");
  assert.equal(view.adminRecoveredFromHistory, true);
  assert.equal(view.adminNeedsReconciliation, true);
  assert.equal(JSON.stringify(current), before, "lớp admin không được sửa đơn gốc");
});

test("bản chốt admin đã lưu vẫn ổn định khi lịch sử gần nhất không còn chứa đơn", () => {
  const current = order();
  const canonicalOrder = order({
    status: "paid",
    transactionId: "zp-stable",
    total: 707000,
    createdAt: "2026-09-01T08:55:27.000Z",
    updatedAt: "2026-09-01T09:00:00.000Z"
  });
  const view = buildAdminOrderView(current, [], {
    orderCode: current.code,
    canonicalOrder,
    paymentStatus: "paid",
    paymentSource: "Lịch sử database đã xác minh",
    paymentAmount: 707000,
    trackingCode: "SPX-STABLE-123",
    shippingStatus: "shipping",
    updatedAt: "2026-09-07T00:00:00.000Z"
  });

  assert.equal(view.total, 707000);
  assert.equal(view.transactionId, "zp-stable");
  assert.equal(view.adminPaymentStatus, "paid");
  assert.equal(view.adminNeedsReconciliation, false);
});

test("admin ưu tiên mã vận đơn và trạng thái giao hàng đã đối soát", () => {
  const current = order({
    code: "BLW-260907120000-SHIP",
    paymentMethod: "cod",
    paymentProvider: "cod",
    status: "pending",
    createdAt: "2026-09-07T12:00:00.000Z"
  });
  const shipping = buildAdminOrderView(current, [], {
    orderCode: current.code,
    pancakeOrderId: "pc-101",
    pancakeStatus: "shipping",
    trackingCode: "SPXVN123456",
    shippingCarrier: "SPX Express",
    shippingStatus: "shipping",
    updatedAt: "2026-09-07T00:00:00.000Z"
  });
  assert.equal(shipping.trackingCode, "SPXVN123456");
  assert.equal(shipping.adminShippingStatus, "shipping");
  assert.equal(shipping.adminPaymentStatus, "cod_pending");
  assert.equal(shipping.adminNeedsReconciliation, false);

  const delivered = buildAdminOrderView(current, [], {
    orderCode: current.code,
    pancakeStatus: "completed",
    shippingStatus: "delivered",
    updatedAt: "2026-09-07T00:00:00.000Z"
  });
  assert.equal(delivered.adminShippingStatus, "delivered");
  assert.equal(delivered.adminPaymentStatus, "cod_collected");
});

test("đơn chưa có liên kết cục bộ vẫn được xếp hàng dò Pancake để lấy mã đến muộn", () => {
  const view = buildAdminOrderView(order({
    paymentMethod: "cod",
    paymentProvider: "cod",
    status: "pending",
    pancakeOrderId: undefined,
    pancakeStatus: undefined,
    externalSync: undefined
  }));
  assert.equal(view.trackingCode, "");
  assert.equal(view.adminNeedsReconciliation, true);
});

test("thời điểm đối soát được trả về để bộ quét luân phiên qua mọi đơn", () => {
  const view = buildAdminOrderView(order(), [], {
    orderCode: "BLW-260901155527-DS9X",
    updatedAt: "2026-09-07T05:02:03.000Z"
  });
  assert.equal(view.adminReconciledAt, "2026-09-07T05:02:03.000Z");
});

test("mô phỏng 2.000 đơn admin không mất, không trùng và phân trang đủ", () => {
  const originals = [];
  const views = [];
  for (let index = 1; index <= 2000; index += 1) {
    const suffix = String(index).padStart(4, "0");
    const current = order({
      id: `admin-${suffix}`,
      code: `BLW-26090712${suffix.slice(0, 2)}${suffix.slice(2)}-T${suffix}`,
      paymentMethod: index % 2 ? "cod" : "zalopay",
      paymentProvider: index % 2 ? "cod" : "zalopay",
      createdAt: "2026-09-07T05:00:00.000Z",
      updatedAt: "2026-09-07T05:00:00.000Z"
    });
    originals.push(JSON.stringify(current));
    const observation = index % 4 === 0 ? {
      orderCode: current.code,
      paymentStatus: current.paymentMethod === "zalopay" ? "paid" : undefined,
      paymentAmount: current.total,
      pancakeStatus: index % 8 === 0 ? "completed" : "shipping",
      trackingCode: `TRACK-${suffix}`,
      shippingStatus: index % 8 === 0 ? "delivered" : "shipping",
      updatedAt: "2026-09-07T05:01:00.000Z"
    } : undefined;
    views.push(buildAdminOrderView(current, [], observation));
  }

  assert.equal(views.length, 2000);
  assert.equal(new Set(views.map((item) => item.code)).size, 2000);
  const pages = [];
  for (let page = 1; page <= 40; page += 1) pages.push(...paginateAdminOrders(views, page, 50).items);
  assert.deepEqual(pages.map((item) => item.code), views.map((item) => item.code));
  assert.deepEqual(views.map((item) => Boolean(item.adminPaymentStatus)), Array(2000).fill(true));
  assert.deepEqual(views.map((_, index) => originals[index]), originals, "mô phỏng không được thay đổi dữ liệu đầu vào");
});

test("đối soát admin chỉ đọc Pancake, không gọi thao tác ghi", async () => {
  const source = await readFile(new URL("../lib/admin-orders.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.createOrder\s*\(/);
  assert.doesNotMatch(source, /\.updateOrderStatus\s*\(/);
  assert.doesNotMatch(source, /\.cancelOrder\s*\(/);
  assert.doesNotMatch(source, /\.assignSpxPartner\s*\(/);
});
