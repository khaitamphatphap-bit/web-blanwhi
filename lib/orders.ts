import { readFile, writeFile } from "fs/promises";
import { ensureJsonFile } from "@/lib/data-store";
import { OrderStatus, ShopOrder } from "@/lib/types";

function ensureStore() {
  return ensureJsonFile<ShopOrder[]>("orders.json", []);
}

export async function readOrders(): Promise<ShopOrder[]> {
  const ordersFile = await ensureStore();
  const raw = await readFile(ordersFile, "utf8");
  try {
    return JSON.parse(raw) as ShopOrder[];
  } catch {
    return [];
  }
}

export async function writeOrders(orders: ShopOrder[]) {
  const ordersFile = await ensureStore();
  await writeFile(ordersFile, JSON.stringify(orders, null, 2), "utf8");
}

export async function createOrder(order: ShopOrder) {
  const orders = await readOrders();
  await writeOrders([order, ...orders]);
  return order;
}

export async function findOrderByCode(code: string) {
  const orders = await readOrders();
  return orders.find((order) => order.code === code) ?? null;
}

export async function updateOrderStatus(
  code: string,
  status: OrderStatus,
  patch: Partial<Pick<ShopOrder, "transactionId" | "providerOrderId" | "providerMessage">> = {}
) {
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

export async function updateOrder(code: string, patch: Partial<ShopOrder>) {
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

export function newOrderCode() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const tail = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `BLW-${stamp}-${tail}`;
}
