export type PancakeVariation = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  raw: Record<string, unknown>;
};

export type PancakeLogLevel = "info" | "warning" | "error";

export type PancakeLog = {
  id: string;
  level: PancakeLogLevel;
  action: string;
  message: string;
  orderCode?: string;
  createdAt: string;
};

export type PancakeQueueJob = {
  id: string;
  type: "order.create" | "order.cancel" | "inventory.sync" | "orders.poll";
  payload: Record<string, unknown>;
  attempts: number;
  availableAt: string;
  createdAt: string;
  lastError?: string;
};

export type PancakeAvailabilityItem = {
  key: string;
  sku: string;
  pancakeProductId: string;
  pancakeVariationId: string;
  pancakeSku: string;
  publishQuantity: number;
  pancakeQuantity: number;
  availableQuantity: number;
  linked: boolean;
  lastSyncedAt?: string;
};
