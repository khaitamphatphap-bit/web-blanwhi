import {
  hasDatabase,
  findKeyedJsonRecordByFieldDatabaseStatus,
  readJsonStore,
  readJsonStoreFallbackStores,
  readKeyedJsonStore,
  readKeyedJsonStoreDatabaseBackups,
  readKeyedJsonStoreDatabase,
  readKeyedJsonRecordDatabaseStatus,
  readKeyedJsonStoreDatabaseStatus,
  readKeyedJsonStoreFallbackStores,
  withDataStoreLock,
  writeJsonStore,
  writeKeyedJsonRecord,
  writeKeyedJsonRecords
} from "@/lib/data-store";
import { OrderStatus, PaymentMethod, ShopOrder } from "@/lib/types";
import { shortOrderCode } from "@/lib/order-code";
import { mergeOrderPatch } from "@/lib/order-state";

const paymentMethods = new Set<PaymentMethod>(["cod", "bank_transfer", "vnpay", "onepay", "alepay", "momo", "zalopay"]);
const deletedOrdersStore = "deleted-orders.json";
const orderRecordsStore = "order-records";
const deletedOrderRecordsStore = "deleted-order-records";
export const unpaidOrderLifetimeMs = 24 * 60 * 60 * 1000;

type DeletedOrderRecord = {
  code: string;
  shortCode: string;
  deletedAt: string;
};

async function readDeletedOrderRecords() {
  if (hasDatabase()) {
    const databaseState = await readKeyedJsonStoreDatabaseStatus<DeletedOrderRecord>(deletedOrderRecordsStore);
    if (databaseState.ok) return Object.values(databaseState.records);
  }

  const [primary, keyed] = await Promise.all([
    readJsonStore<DeletedOrderRecord[]>(deletedOrdersStore, []),
    readKeyedJsonStoreFallbackStores<DeletedOrderRecord>(deletedOrderRecordsStore, {})
  ]);
  const byCode = new Map<string, DeletedOrderRecord>();
  [...primary, ...Object.values(keyed)].forEach((record) => {
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

function productionOrdersRequireDatabase() {
  return process.env.BLANWHI_REQUIRE_DATABASE_ORDERS === "true" || Boolean(process.env.VERCEL);
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
    || normalizedOrder.pancakeStatus === "cancelled";
  return {
    ...normalizedOrder,
    status: cancellationRecorded ? "cancelled" : normalizedOrder.status,
    paymentMethod,
    paymentProvider: String(normalizedOrder.paymentProvider || paymentMethod).trim().toLowerCase()
  };
}

export async function readOrders(): Promise<ShopOrder[]> {
  if (hasDatabase()) {
    const [databaseState, deleted] = await Promise.all([
      readKeyedJsonStoreDatabaseStatus<ShopOrder>(orderRecordsStore),
      readDeletedOrderRecords()
    ]);
    if (databaseState.ok) {
      return compactOrders(Object.values(databaseState.records), deletedOrderKeys(deleted)).map(normalizeOrder);
    }

    // Disaster recovery is intentionally cold-path. Do not download R2/Blob
    // archives during every healthy request because that multiplies network
    // sockets and can exhaust a long-lived Vercel Fluid process.
    const [fallbackOrders, fallbackRecords] = await Promise.all([
      readJsonStoreFallbackStores<ShopOrder[]>("orders.json", []),
      readKeyedJsonStoreDatabaseBackups<ShopOrder>(orderRecordsStore)
    ]);
    return compactOrders([
      ...fallbackOrders,
      ...Object.values(fallbackRecords)
    ], deletedOrderKeys(deleted)).map(normalizeOrder);
  }

  const [orders, orderRecords, deleted] = await Promise.all([
    readJsonStore<ShopOrder[]>("orders.json", []),
    readKeyedJsonStore<ShopOrder>(orderRecordsStore, {}),
    readDeletedOrderRecords()
  ]);
  return compactOrders([
    ...orders,
    ...Object.values(orderRecords)
  ], deletedOrderKeys(deleted)).map(normalizeOrder);
}

export async function writeOrders(orders: ShopOrder[]) {
  return withDataStoreLock("orders-write", async () => {
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
    const latest = compactOrders([...(await readOrders()), ...filtered], deletedKeys);
    await Promise.all([
      writeJsonStore("orders.json", latest),
      writeKeyedJsonRecords(orderRecordsStore, Object.fromEntries(latest.map((order) => [orderRecordKey(order.code), order])))
    ]);
  });
}

export async function createOrder(order: ShopOrder) {
  if (productionOrdersRequireDatabase() && !hasDatabase()) {
    throw new Error("Database thật chưa được cấu hình. Hệ thống đã chặn tạo đơn mới để tránh mất đơn hàng.");
  }
  const lockKey = order.checkoutRequestId || order.code;
  return withDataStoreLock(`order-create:${lockKey}`, async () => {
    let orders: ShopOrder[] = [];
    let existing: ShopOrder | null | undefined;
    if (hasDatabase()) {
      const existingState = order.checkoutRequestId
        ? await findKeyedJsonRecordByFieldDatabaseStatus<ShopOrder>(orderRecordsStore, "checkoutRequestId", order.checkoutRequestId)
        : await readKeyedJsonRecordDatabaseStatus<ShopOrder>(orderRecordsStore, orderRecordKey(order.code));
      if (!existingState.ok) {
        throw new Error("Không đọc được database đơn hàng. Hệ thống đã dừng tạo đơn để tránh tạo trùng hoặc mất đơn.");
      }
      existing = existingState.record;
      if (existing && order.customerDeviceId && existing.customerDeviceId !== order.customerDeviceId) existing = null;
      if (!existing && order.checkoutRequestId) {
        const codeState = await readKeyedJsonRecordDatabaseStatus<ShopOrder>(orderRecordsStore, orderRecordKey(order.code));
        if (!codeState.ok) {
          throw new Error("Không kiểm tra được mã đơn trong database. Hệ thống đã dừng tạo đơn để tránh ghi đè dữ liệu.");
        }
        if (codeState.record) {
          throw new Error("Mã đơn bị trùng. Vui lòng đặt lại để hệ thống tạo mã đơn mới.");
        }
      }

      const deletedState = await readKeyedJsonRecordDatabaseStatus<DeletedOrderRecord>(deletedOrderRecordsStore, orderRecordKey(order.code));
      if (!deletedState.ok) {
        throw new Error("Không kiểm tra được lịch sử xóa đơn. Hệ thống đã dừng tạo đơn để bảo vệ dữ liệu.");
      }
      if (deletedState.record) throw new Error("Đơn này đã được xóa trong admin nên không tự tạo lại.");
    } else {
      if (await isDeletedOrderCode(order.code)) {
        throw new Error("Đơn này đã được xóa trong admin nên không tự tạo lại.");
      }
      orders = await readOrders();
      existing = order.checkoutRequestId
        ? orders.find((candidate) => candidate.checkoutRequestId === order.checkoutRequestId
          && (!order.customerDeviceId || candidate.customerDeviceId === order.customerDeviceId))
        : orders.find((candidate) => orderRecordKey(candidate.code) === orderRecordKey(order.code));
    }
    if (existing) return existing;
    await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(order.code), order);
    if (!hasDatabase()) {
      await writeOrders([order, ...orders.filter((candidate) => candidate.code !== order.code)]);
    }
    return order;
  });
}

export async function findOrderByCheckoutRequestId(checkoutRequestId: string, customerDeviceId?: string) {
  const normalized = String(checkoutRequestId || "").trim();
  if (!normalized) return null;
  if (hasDatabase()) {
    const state = await findKeyedJsonRecordByFieldDatabaseStatus<ShopOrder>(orderRecordsStore, "checkoutRequestId", normalized);
    if (!state.ok) throw new Error("Không đọc được database đơn hàng.");
    const order = state.record;
    return order && (!customerDeviceId || order.customerDeviceId === customerDeviceId) ? normalizeOrder(order) : null;
  }
  return (await readOrders()).find((order) => order.checkoutRequestId === normalized
    && (!customerDeviceId || order.customerDeviceId === customerDeviceId)) ?? null;
}

export async function findOrderByCode(code: string) {
  const normalized = String(code || "").trim().toUpperCase();
  if (hasDatabase()) {
    const state = await readKeyedJsonRecordDatabaseStatus<ShopOrder>(orderRecordsStore, normalized);
    if (state.ok && state.record) return normalizeOrder(state.record);
  }
  const orders = await readOrders();
  return orders.find((order) => order.code.toUpperCase() === normalized || shortOrderCode(order.code) === normalized) ?? null;
}

export async function updateOrderStatus(
  code: string,
  status: OrderStatus,
  patch: Partial<Pick<ShopOrder, "transactionId" | "providerOrderId" | "paymentProviderOrderId" | "providerMessage">> = {}
): Promise<ShopOrder | null> {
  return withDataStoreLock(`order-update:${orderRecordKey(code)}`, async () => {
    if (hasDatabase() && !(await readKeyedJsonStoreDatabaseStatus<ShopOrder>(orderRecordsStore)).ok) {
      throw new Error("Không đọc được database đơn hàng nên chưa cập nhật để tránh ghi đè dữ liệu.");
    }
    if (await isDeletedOrderCode(code)) return null;
    const orders = await readOrders();
    let updated: ShopOrder | null = null;
    const next = orders.map((order) => {
      if (orderRecordKey(order.code) !== orderRecordKey(code)) return order;
      updated = { ...order, ...patch, status, updatedAt: new Date().toISOString() };
      return updated;
    });
    const updatedOrder = updated as ShopOrder | null;
    if (updatedOrder && hasDatabase()) await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(updatedOrder.code), updatedOrder);
    else await writeOrders(next);
    return updatedOrder;
  });
}

export async function updateOrder(code: string, patch: Partial<ShopOrder>): Promise<ShopOrder | null> {
  return withDataStoreLock(`order-update:${orderRecordKey(code)}`, async () => {
    if (hasDatabase()) {
      const recordKey = orderRecordKey(code);
      const [orderState, deletedState] = await Promise.all([
        readKeyedJsonRecordDatabaseStatus<ShopOrder>(orderRecordsStore, recordKey),
        readKeyedJsonRecordDatabaseStatus<DeletedOrderRecord>(deletedOrderRecordsStore, recordKey)
      ]);
      if (!orderState.ok || !deletedState.ok) {
        throw new Error("Không đọc được database đơn hàng nên chưa cập nhật để tránh ghi đè dữ liệu.");
      }
      if (deletedState.record) return null;
      if (orderState.record) {
        // A stale Pancake poll must never restore packing/shipping after the
        // customer cancellation has already been committed.
        const updated = mergeOrderPatch(normalizeOrder(orderState.record), patch);
        await writeKeyedJsonRecord(orderRecordsStore, recordKey, updated);
        return updated;
      }
    }
    if (await isDeletedOrderCode(code)) return null;
    const orders = await readOrders();
    let updated: ShopOrder | null = null;
    const next = orders.map((order) => {
      if (orderRecordKey(order.code) !== orderRecordKey(code)) return order;
      updated = {
        ...order,
        ...patch,
        externalSync: { ...order.externalSync, ...patch.externalSync },
        updatedAt: new Date().toISOString()
      };
      return updated;
    });
    const updatedOrder = updated as ShopOrder | null;
    if (updatedOrder && hasDatabase()) await writeKeyedJsonRecord(orderRecordsStore, orderRecordKey(updatedOrder.code), updatedOrder);
    else await writeOrders(next);
    return updatedOrder;
  });
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
  const allRecords = Array.from(byCode.values());
  await Promise.all([
    writeJsonStore(deletedOrdersStore, allRecords),
    writeKeyedJsonRecords(deletedOrderRecordsStore, Object.fromEntries(records.map((record) => [orderRecordKey(record.code), record])))
  ]);
}

export function newOrderCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `BLW-${stamp}-${tail}`;
}
