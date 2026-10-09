import { readJsonStore, withDataStoreLock, writeJsonStore } from "@/lib/data-store";
import {
  defaultPancakeRoutingState,
  type PancakeConnectionId,
  type PancakeProductSyncState,
  type PancakeRoutingState
} from "@/lib/pancake/connection-routing";

export {
  defaultPancakeRoutingState,
  pancakeConnectionForOrder,
  pancakeConnectionForQueue,
  stampPancakeConnection
} from "@/lib/pancake/connection-routing";
export type { PancakeConnectionId, PancakeProductSyncState, PancakeRoutingState } from "@/lib/pancake/connection-routing";

export type PancakeConnectionRuntime = {
  id: PancakeConnectionId;
  name: string;
  baseUrl: string;
  apiKey: string;
  token: string;
  shopId: string;
  webhookSecret: string;
  orderSourceName: string;
  orderSourceId: string;
  spxPartnerId: string;
  spxAccountId: string;
};

const routingStore = "pancake-routing.json";

function env(name: string) {
  return String(process.env[name] || "").trim();
}

export function pancakeConnection(id: PancakeConnectionId): PancakeConnectionRuntime {
  const prefix = id === "shop-1" ? "PANCAKE" : "PANCAKE2";
  return {
    id,
    name: env(`${prefix}_NAME`) || (id === "shop-1" ? "Pancake Shop 1" : "Pancake Shop 2"),
    baseUrl: env(`${prefix}_API_BASE_URL`) || "https://pos.pages.fm/api/v1",
    apiKey: env(`${prefix}_API_KEY`),
    token: env(`${prefix}_TOKEN`),
    shopId: env(`${prefix}_SHOP_ID`),
    webhookSecret: env(`${prefix}_WEBHOOK_SECRET`),
    orderSourceName: env(`${prefix}_ORDER_SOURCE_NAME`) || "facebook",
    orderSourceId: env(`${prefix}_ORDER_SOURCE_ID`),
    spxPartnerId: env(`${prefix}_SPX_PARTNER_ID`),
    spxAccountId: env(`${prefix}_SPX_ACCOUNT_ID`)
  };
}

export function connectionConfigured(connection: PancakeConnectionRuntime) {
  return Boolean(connection.apiKey && connection.shopId && connection.webhookSecret);
}

function normalizeSyncState(value: Partial<PancakeProductSyncState> | undefined, fallback: PancakeProductSyncState) {
  const statuses = new Set<PancakeProductSyncState["status"]>(["legacy", "not_started", "running", "ready", "failed"]);
  return {
    status: statuses.has(value?.status as PancakeProductSyncState["status"]) ? value!.status! : fallback.status,
    linkedCount: Math.max(0, Math.floor(Number(value?.linkedCount) || fallback.linkedCount)),
    totalCount: Math.max(0, Math.floor(Number(value?.totalCount) || fallback.totalCount)),
    ...(value?.lastSyncedAt ? { lastSyncedAt: String(value.lastSyncedAt) } : {}),
    ...(value?.message ? { message: String(value.message) } : {})
  } satisfies PancakeProductSyncState;
}

export async function readPancakeRoutingState() {
  const saved = await readJsonStore<Partial<PancakeRoutingState>>(routingStore, defaultPancakeRoutingState);
  return {
    activeNewOrders: saved.activeNewOrders === "shop-2" ? "shop-2" : "shop-1",
    productSync: {
      "shop-1": normalizeSyncState(saved.productSync?.["shop-1"], defaultPancakeRoutingState.productSync["shop-1"]),
      "shop-2": normalizeSyncState(saved.productSync?.["shop-2"], defaultPancakeRoutingState.productSync["shop-2"])
    }
  } satisfies PancakeRoutingState;
}

export function connectionReadyForNewOrders(id: PancakeConnectionId, state: PancakeRoutingState) {
  if (id === "shop-1") return connectionConfigured(pancakeConnection(id));
  const sync = state.productSync[id];
  return connectionConfigured(pancakeConnection(id))
    && sync.status === "ready"
    && sync.totalCount > 0
    && sync.linkedCount === sync.totalCount;
}

export async function setActivePancakeConnection(id: PancakeConnectionId) {
  return withDataStoreLock("pancake-routing", async () => {
    const current = await readPancakeRoutingState();
    if (!connectionReadyForNewOrders(id, current)) {
      throw new Error(`${pancakeConnection(id).name} chưa đủ API, webhook hoặc liên kết sản phẩm để nhận đơn mới.`);
    }
    const next = { ...current, activeNewOrders: id } satisfies PancakeRoutingState;
    await writeJsonStore(routingStore, next);
    return next;
  });
}

export async function setPancakeProductSyncState(id: PancakeConnectionId, sync: PancakeProductSyncState) {
  return withDataStoreLock("pancake-routing", async () => {
    const current = await readPancakeRoutingState();
    const next = {
      ...current,
      productSync: { ...current.productSync, [id]: normalizeSyncState(sync, current.productSync[id]) }
    } satisfies PancakeRoutingState;
    await writeJsonStore(routingStore, next);
    return next;
  });
}
