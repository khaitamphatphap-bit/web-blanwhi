import { readJsonStore, writeJsonStore } from "@/lib/data-store";
import { OrderStatus, PaymentMethod, ShopOrder } from "@/lib/types";
import { shortOrderCode } from "@/lib/order-code";

const paymentMethods = new Set<PaymentMethod>(["cod", "bank_transfer", "vnpay", "onepay", "alepay", "momo", "zalopay"]);

function normalizePaymentMethod(value: unknown): PaymentMethod {
  const normalized = String(value || "").trim().toLowerCase();
  if (["cod", "cash", "cash_on_delivery", "cash-on-delivery"].includes(normalized)) return "cod";
  return paymentMethods.has(normalized as PaymentMethod) ? normalized as PaymentMethod : "zalopay";
}

export async function readOrders(): Promise<ShopOrder[]> {
  const orders = await readJsonStore<ShopOrder[]>("orders.json", []);
  return orders.map((order) => {
    const cancellationRecorded = order.status === "cancelled"
      || order.shippingStatus === "cancelled"
      || order.pancakeStatus === "cancelled"
      || Boolean(order.refundStatus);
    return {
      ...order,
      status: cancellationRecorded ? "cancelled" : order.status,
      paymentMethod: normalizePaymentMethod(order.paymentMethod || order.paymentProvider),
      paymentProvider: String(order.paymentProvider || normalizePaymentMethod(order.paymentMethod || order.paymentProvider)).trim().toLowerCase()
    };
  });
}

export async function writeOrders(orders: ShopOrder[]) {
  await writeJsonStore("orders.json", orders);
}

export async function createOrder(order: ShopOrder) {
  const orders = await readOrders();
  await writeOrders([order, ...orders]);
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
  await writeOrders(next);
  return updated;
}

export async function updateOrder(code: string, patch: Partial<ShopOrder>): Promise<ShopOrder | null> {
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
  await writeOrders(next);
  return updated;
}

export async function deleteOrdersByCodes(codes: string[]) {
  const normalized = new Set(codes.map((code) => String(code || "").trim().toUpperCase()).filter(Boolean));
  if (!normalized.size) return { deletedCount: 0, orders: await readOrders() };

  const orders = await readOrders();
  const next = orders.filter((order) => {
    const fullCode = order.code.toUpperCase();
    const shortCode = shortOrderCode(order.code).toUpperCase();
    return !normalized.has(fullCode) && !normalized.has(shortCode);
  });
  const deletedCount = orders.length - next.length;
  if (deletedCount > 0) await writeOrders(next);
  return { deletedCount, orders: next };
}

export function newOrderCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `BLW-${stamp}-${tail}`;
}
