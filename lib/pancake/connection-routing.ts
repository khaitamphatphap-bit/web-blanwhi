export type PancakeConnectionId = "shop-1" | "shop-2";

export type PancakeProductSyncState = {
  status: "legacy" | "not_started" | "running" | "ready" | "failed";
  linkedCount: number;
  totalCount: number;
  lastSyncedAt?: string;
  message?: string;
};

export type PancakeRoutingState = {
  activeNewOrders: PancakeConnectionId;
  productSync: Record<PancakeConnectionId, PancakeProductSyncState>;
};

export const defaultPancakeRoutingState: PancakeRoutingState = {
  activeNewOrders: "shop-1",
  productSync: {
    "shop-1": { status: "legacy", linkedCount: 0, totalCount: 0 },
    "shop-2": { status: "not_started", linkedCount: 0, totalCount: 0 }
  }
};

type RoutedOrder = { pancakeConnectionId?: PancakeConnectionId };
type RoutedJob = { payload: Record<string, unknown> };

export function pancakeConnectionForOrder(order: RoutedOrder) {
  return order.pancakeConnectionId === "shop-2" ? "shop-2" : "shop-1";
}

export function pancakeConnectionForQueue(job: RoutedJob, order?: RoutedOrder) {
  const queued = job.payload.pancakeConnectionId;
  if (queued === "shop-2") return "shop-2";
  if (queued === "shop-1") return "shop-1";
  return order ? pancakeConnectionForOrder(order) : "shop-1";
}

export function stampPancakeConnection<T extends RoutedOrder>(order: T, state: PancakeRoutingState): T {
  if (order.pancakeConnectionId) return order;
  return { ...order, pancakeConnectionId: state.activeNewOrders };
}
