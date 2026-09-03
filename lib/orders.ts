import {
  hasDatabase,
  readJsonStore,
  readJsonStoreFallbackStores,
  readKeyedJsonStore,
  readKeyedJsonStoreDatabase,
  readKeyedJsonStoreFallbackStores,
  writeJsonStore,
  writeKeyedJsonRecord,
  writeKeyedJsonRecords
} from "@/lib/data-store";
import { OrderStatus, PaymentMethod, ShopOrder } from "@/lib/types";
import { shortOrderCode } from "@/lib/order-code";

const paymentMethods = new Set<PaymentMethod>(["cod", "bank_transfer", "vnpay", "onepay", "alepay", "momo", "zalopay"]);
const deletedOrdersStore = "deleted-orders.json";
const orderRecordsStore = "order-records";
export const unpaidOrderLifetimeMs = 24 * 60 * 60 * 1000;

type DeletedOrderRecord = {
  code: string;
  shortCode: string;
  deletedAt: string;
};

async function readDeletedOrderRecords() {
  const [primary, fallback] = await Promise.all([
    readJsonStore<DeletedOrderRecord[]>(deletedOrdersStore, []),
    hasDatabase() ? readJsonStoreFallbackStores<DeletedOrderRecord[]>(deletedOrdersStore, []) : Promise.resolve([])
  ]);
  const byCode = new Map<string, DeletedOrderRecord>();
  [...fallback, ...primary].forEach((record) => {
    const key = String(record.code || record.shortCode || "").trim().toUpperCase();
    if (key) byCode.set(key, record);
  });
  return Array.from(byCode.values());
}

function deletedOrderKeys(records: DeletedOrderRecord[]) {
  const keys = new Set<string>();
  records.forEach((record) => {
    if (record.code) keys.add(record.code.trim().toUpperCase());
    if (record.shortCode) keys.add(record.shortCode.trim().toUpperCase());
  });
  return keys;
}

function orderWasDeleted(order: Pick<ShopOrder, "code">, deletedKeys: Set<string>) {
  const code = String(order.code || "").trim().toUpperCase();
  return deletedKeys.has(code) || deletedKeys.has(shortOrderCode(code));
}

function normalizePaymentMethod(value: unknown): PaymentMethod {
  const normalized = String(value || "").trim().toLowerCase();
  if (["cod", "cash", "cash_on_delivery", "cash-on-delivery"].includes(normalized)) return "cod";
  return paymentMethods.has(normalized as PaymentMethod) ? normalized as PaymentMethod : "zalopay";
}

function orderRecordKey(code: string) {
  return String(code || "").trim().toUpperCase();
}

function newerOrder(left: ShopOrder, right: ShopOrder) {
  const leftTime = new Date(left.updatedAt || left.createdAt || "").getTime();
  const rightTime = new Date(right.updatedAt || right.createdAt || "").getTime();
  return (Number.isFinite(rightTime) ? rightTime : 0) >= (Number.isFinite(leftTime) ? leftTime : 0) ? right : left;
}

function compactOrders(orders: ShopOrder[], deletedKeys: Set<string>) {
  const byCode = new Map<string, ShopOrder>();
  orders.forEach((order) => {
    const key = orderRecordKey(order.code);
    if (!key || orderWasDeleted(order, deletedKeys)) return;
    const existing = byCode.get(key);
    byCode.set(key, existing ? newerOrder(existing, order) : order);
  });
  return Array.from(byCode.values()).sort((left, right) => {
    const leftTime = new Date(left.createdAt || left.updatedAt || "").getTime();
    const rightTime = new Date(right.createdAt || right.updatedAt || "").getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

function normalizeOrder(order: ShopOrder): ShopOrder {
  const paymentMethod = normalizePaymentMethod(order.paymentMethod || order.paymentProvider);
  const createdAt = new Date(order.createdAt).getTime();
  const paymentDeadline = Number.isFinite(createdAt) ? createdAt + unpaidOrderLifetimeMs : Number.POSITIVE_INFINITY;
  const paymentExpired = order.status === "pending"
    && paymentMethod !== "cod"
    && !order.transactionId
    && Date.now() >= paymentDeadline;
  const normalizedOrder: ShopOrder = paymentExpired ? {
    ...order,
    status: "cancelled",
    shippingStatus: "cancelled",
    refundStatus: "not_required",
    refundMessage: "",
    paymentExpiredAt: order.paymentExpiredAt || new Date(paymentDeadline).toISOString(),
    cancellationReason: "Hết hạn thanh toán",
    updatedAt: order.paymentExpiredAt || new Date(paymentDeadline).toISOString()
  } : order;
  const cancellationRecorded = normalizedOrder.status === "cancelled"
    || normalizedOrder.shippingStatus === "cancelled"
    || normalizedOrder.pancakeStatus === "cancelled"
    || Boolean(normalizedOrder.refundStatus);
  return {
    ...normalizedOrder,
    status: cancellationRecorded ? "cancelled" : normalizedOrder.status,
    paymentMethod,
    paymentProvider: String(normalizedOrder.paymentProvider || paymentMethod).trim().toLowerCase()
  };
}

export async function readOrders(): Promise<ShopOrder[]> {
  const emptyOrders: ShopOrder[] = [];
  const emptyOrderRecords: Record<string, ShopOrder> = {};
  const [orders, orderRecords, fallbackOrders, fallbackRecords, deleted] = await Promise.all([
    readJsonStore<ShopOrder[]>("orders.json", []),
    readKeyedJsonStore<ShopOrder>(orderRecordsStore, {}),
    hasDatabase() ? readJsonStoreFallbackStores<ShopOrder[]>("orders.json", []) : Promise.resolve(emptyOrders),
    hasDatabase() ? readKeyedJsonStoreFallbackStores<ShopOrder>(orderRecordsStore, {}) : Promise.resolve(emptyOrderRecords),
    readDeletedOrderRecords()
  ]);
  const deletedKeys = deletedOrderKeys(deleted);
  return compactOrders([
    ...fallbackOrders,
    ...Object.values(fallbackRecords || {}),
    ...orders,
    ...Object.values(orderRecords || {})
  ], deletedKeys).map(normalizeOrder);
}

export async function writeOrders(orders: ShopOrder[]) {
  const deletedKeys = deletedOrderKeys(await readDeletedOrderRecords());
  const filtered = compactOrders(orders, deletedKeys);
  if (hasDatabase()) {
    const databaseRecords = await readKeyedJsonStoreDatabase<ShopOrder>(orderRecordsStore);
    const databaseKeys = new Set(Object.keys(databaseRecords));
    const recordsToUpdate = filtered.filter((order) => databaseKeys.has(orderRecordKey(order.code)));
    if (recordsToUpdate.length) {
      await writeKeyedJsonRecords(orderRecordsStore, Object.fromEntries(recordsToUpdate.map((order) => [orderRecordKey(order.code), order])));
    }
    return;
  }
  await Promise.all([
    writeJsonStore("orders.json", filtered),
    writeKeyedJsonRecords(orderRecordsStore, Object.fromEntries(filtered.map((order) => [orderRecordKey(order.code), order])))
  ]);
}

export async function createOrder(order: ShopOrder) {
  if (await isDeletedOrderCode(order.code)) {
    throw new Error("Đơn này đã được xóa trong admin nên không tự tạo lại.");
  }
  const orders = await readOrders();
  const existing = order.checkoutRequestId
    ? orders.find((candidate) => candidate.checkoutRequestId === order.checkoutRequestId
      && (!order.customerDeviceId || candidate.customerDeviceId === order.customerDeviceId))
    : null;
  if (existing) return existing;
  await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(order.code), order);
  if (!hasDatabase()) {
    await writeOrders([order, ...orders.filter((candidate) => candidate.code !== order.code)]);
  }
  return order;
}

export async function findOrderByCode(code: string) {
  const orders = await readOrders();
  const normalized = String(code || "").trim().toUpperCase();
  return orders.find((order) => order.code.toUpperCase() === normalized || shortOrderCode(order.code) === normalized) ?? null;
}

export async function updateOrderStatus(
  code: string,
  status: OrderStatus,
  patch: Partial<Pick<ShopOrder, "transactionId" | "providerOrderId" | "paymentProviderOrderId" | "providerMessage">> = {}
): Promise<ShopOrder | null> {
  if (await isDeletedOrderCode(code)) return null;
  const orders = await readOrders();
  let updated: ShopOrder | null = null;
  const next = orders.map((order) => {
    if (order.code !== code) return order;
    updated = {
      ...order,
      ...patch,
      status,
      updatedAt: new Date().toISOString()
    };
    return updated;
  });
  const updatedOrder = updated as ShopOrder | null;
  if (updatedOrder && hasDatabase()) {
    await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(updatedOrder.code), updatedOrder);
  } else {
    await writeOrders(next);
  }
  return updatedOrder;
}

export async function updateOrder(code: string, patch: Partial<ShopOrder>): Promise<ShopOrder | null> {
  if (await isDeletedOrderCode(code)) return null;
  const orders = await readOrders();
  let updated: ShopOrder | null = null;
  const next = orders.map((order) => {
    if (order.code !== code) return order;
    updated = {
      ...order,
      ...patch,
      externalSync: {
        ...order.externalSync,
        ...patch.externalSync
      },
      updatedAt: new Date().toISOString()
    };
    return updated;
  });
  const updatedOrder = updated as ShopOrder | null;
  if (updatedOrder && hasDatabase()) {
    await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(updatedOrder.code), updatedOrder);
  } else {
    await writeOrders(next);
  }
  return updatedOrder;
}

export async function deleteOrdersByCodes(codes: string[]) {
  const normalized = new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean));
  if (!normalized.size) return { deletedCount: 0, orders: await readOrders() };

  const orders = await readOrders();
  const deletedAt = new Date().toISOString();
  const requestedDeleted = Array.from(normalized).map((code) => ({
    code,
    shortCode: shortOrderCode(code).toUpperCase(),
    deletedAt
  }));
  const matchedDeleted = orders
    .filter((order) => normalized.has(order.code.toUpperCase()) || normalized.has(shortOrderCode(order.code).toUpperCase()))
    .map((order) => ({
      code: order.code.toUpperCase(),
      shortCode: shortOrderCode(order.code).toUpperCase(),
      deletedAt
    }));
  const next = orders.filter((order) => {
    const fullCode = order.code.toUpperCase();
    const shortCode = shortOrderCode(order.code).toUpperCase();
    return !normalized.has(fullCode) && !normalized.has(shortCode);
  });
  const deletedCount = orders.length - next.length;
  await Promise.all([
    hasDatabase() ? Promise.resolve() : writeOrders(next),
    rememberDeletedOrders([...requestedDeleted, ...matchedDeleted])
  ]);
  return { deletedCount, orders: next };
}

export async function isDeletedOrderCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return false;
  const keys = deletedOrderKeys(await readDeletedOrderRecords());
  return keys.has(normalized) || keys.has(shortOrderCode(normalized));
}

async function rememberDeletedOrders(records: DeletedOrderRecord[]) {
  if (!records.length) return;
  const current = await readJsonStore<DeletedOrderRecord[]>(deletedOrdersStore, []);
  const byCode = new Map<string, DeletedOrderRecord>();
  [...current, ...records].forEach((record) => {
    if (!record.code) return;
    byCode.set(record.code, record);
  });
  await writeJsonStore(deletedOrdersStore, Array.from(byCode.values()).slice(-5000));
}

export function newOrderCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `BLW-${stamp}-${tail}`;
}
