import assert from "node:assert/strict";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3021";
const iterations = Math.max(1, Math.min(200, Math.floor(Number(process.env.SMOKE_ITERATIONS || 30))));
const parsedBaseUrl = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedBaseUrl.hostname) && process.env.ALLOW_REMOTE_SMOKE !== "true") {
  throw new Error("Smoke test chỉ được chạy trên localhost nếu chưa bật ALLOW_REMOTE_SMOKE=true.");
}

function money(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentage) - 1))] || 0;
}

async function requestJson(pathname, init = {}) {
  const startedAt = performance.now();
  const response = await fetch(new URL(pathname, baseUrl), {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    },
    signal: AbortSignal.timeout(10_000)
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  const wallMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${pathname} trả ${response.status}: ${body.error || text}`);
  }
  return {
    body,
    wallMs,
    serverMs: Number(response.headers.get("x-blanwhi-duration-ms") || 0),
    serverTiming: response.headers.get("server-timing") || ""
  };
}

function candidates(site) {
  return (site.products || []).flatMap((product) => product.active === false ? [] : (product.inventory || [])
    .filter((row) => Number(row.publishQuantity || 0) >= 4 && Number(row.pancakeQuantity || 0) >= 4)
    .map((row) => ({ product, row })));
}

function inventoryQuantity(site, productId, inventoryKey) {
  const product = (site.products || []).find((item) => item.id === productId);
  const row = (product?.inventory || []).find((item) => item.key === inventoryKey);
  assert.ok(row, `không tìm thấy tồn ${productId}/${inventoryKey}`);
  return Number(row.publishQuantity || 0);
}

const runId = Date.now().toString(36);
const checkoutDurations = [];
const cancelDurations = [];
const serverCheckoutDurations = [];
const serverCancelDurations = [];

for (let index = 1; index <= iterations; index += 1) {
  const beforeSite = (await requestJson(`/api/site?smoke=${runId}-${index}-before`)).body;
  const available = candidates(beforeSite);
  assert.ok(available.length, "catalog cô lập không còn phân loại đủ tồn để kiểm thử");
  const { product, row } = available[(index - 1) % available.length];
  const quantity = (index % 3) + 1;
  const beforeQuantity = inventoryQuantity(beforeSite, product.id, row.key);
  assert.ok(beforeQuantity >= quantity);

  const phone = `0911${String(index).padStart(6, "0")}`;
  const deviceId = `smoke-device-${runId}-${index}`;
  const checkoutRequestId = `smoke-checkout-${runId}-${index}`;
  const payload = {
    customerDeviceId: deviceId,
    checkoutRequestId,
    customer: {
      name: `Smoke ${index}`,
      phone,
      address: `${index} Đường kiểm thử, Phường 1, Quận 1, TP Hồ Chí Minh`,
      house: `${index} Đường kiểm thử`,
      ward: "Phường 1",
      wardId: "smoke-ward-1",
      district: "Quận 1",
      districtId: "smoke-district-1",
      province: "TP Hồ Chí Minh",
      provinceId: "smoke-province-1"
    },
    paymentMethod: "cod",
    items: [{
      productId: product.id,
      inventoryKey: row.key,
      sku: row.sku,
      pancakeSku: row.pancakeSku,
      pancakeProductId: row.pancakeProductId,
      pancakeVariationId: row.pancakeVariationId,
      classificationId: row.classificationId || "",
      name: product.name,
      qty: quantity,
      price: money(product.price),
      color: row.color || "",
      size: row.size || ""
    }],
    shipping: { type: "standard", method: "Giao tiêu chuẩn" }
  };

  const created = await requestJson("/api/payments/create", { method: "POST", body: JSON.stringify(payload) });
  checkoutDurations.push(created.wallMs);
  serverCheckoutDurations.push(created.serverMs);
  assert.ok(created.body.order?.code, "checkout phải trả mã đơn sau khi database xác nhận");
  assert.match(created.serverTiming, /database;dur=/);
  const orderCode = created.body.order.code;

  const duplicate = await requestJson("/api/payments/create", { method: "POST", body: JSON.stringify(payload) });
  assert.equal(duplicate.body.order?.code, orderCode, "checkoutRequestId phải trả đúng đơn cũ");
  assert.equal(duplicate.body.deduplicated, true, "lần bấm lại phải được đánh dấu chống trùng");

  const afterCreateSite = (await requestJson(`/api/site?smoke=${runId}-${index}-created`)).body;
  assert.equal(inventoryQuantity(afterCreateSite, product.id, row.key), beforeQuantity - quantity, "tồn phải giảm đúng một lần");

  const customerOrders = await requestJson("/api/orders/customer", {
    method: "POST",
    body: JSON.stringify({ deviceId, knownCodes: [orderCode], limit: 100 })
  });
  assert.ok(customerOrders.body.orders.some((order) => order.code === orderCode), "thiết bị đặt hàng phải đọc lại được đơn");

  const cancelled = await requestJson(`/api/orders/${encodeURIComponent(orderCode)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ phone, reason: "Smoke test cô lập" })
  });
  cancelDurations.push(cancelled.wallMs);
  serverCancelDurations.push(cancelled.serverMs);
  assert.equal(cancelled.body.order?.status, "cancelled", "API chỉ báo thành công khi database đã ghi trạng thái hủy");
  assert.match(cancelled.serverTiming, /database_cancel;dur=/);

  const afterCancelSite = (await requestJson(`/api/site?smoke=${runId}-${index}-cancelled`)).body;
  assert.equal(inventoryQuantity(afterCancelSite, product.id, row.key), beforeQuantity, "hủy phải hoàn lại đúng tồn ban đầu");

  const cancelledOrders = await requestJson("/api/orders/customer", {
    method: "POST",
    body: JSON.stringify({ deviceId, knownCodes: [orderCode], limit: 100 })
  });
  assert.equal(cancelledOrders.body.orders.find((order) => order.code === orderCode)?.status, "cancelled", "đơn đọc lại phải thực sự đã hủy");
}

const report = {
  baseUrl,
  iterations,
  checkout: {
    averageMs: Math.round(checkoutDurations.reduce((sum, value) => sum + value, 0) / checkoutDurations.length),
    p95Ms: Math.round(percentile(checkoutDurations, 0.95)),
    maxMs: Math.round(Math.max(...checkoutDurations)),
    serverP95Ms: Math.round(percentile(serverCheckoutDurations, 0.95))
  },
  cancel: {
    averageMs: Math.round(cancelDurations.reduce((sum, value) => sum + value, 0) / cancelDurations.length),
    p95Ms: Math.round(percentile(cancelDurations, 0.95)),
    maxMs: Math.round(Math.max(...cancelDurations)),
    serverP95Ms: Math.round(percentile(serverCancelDurations, 0.95))
  }
};

assert.ok(report.checkout.p95Ms < 2_000, `checkout p95 quá chậm: ${report.checkout.p95Ms}ms`);
assert.ok(report.cancel.p95Ms < 2_000, `cancel p95 quá chậm: ${report.cancel.p95Ms}ms`);
console.log(`SMOKE_RESULT ${JSON.stringify(report)}`);
