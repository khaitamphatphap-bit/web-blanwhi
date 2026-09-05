import {
  deleteEphemeralJsonRecord,
  readEphemeralJsonRecord,
  writeEphemeralJsonRecord
} from "@/lib/data-store";

const cartDraftNamespace = "customer-cart-drafts";
const cartDraftTtlSeconds = 60 * 60 * 24 * 30;

export type CartDraftItem = {
  productId: string;
  cartId: string;
  classificationId?: string;
  classificationName?: string;
  classificationIndex?: number;
  color?: string;
  size?: string;
  quantity: number;
  inventoryKey?: string;
  sku?: string;
  pancakeSku?: string;
  pancakeProductId?: string;
  pancakeVariationId?: string;
  message?: string;
  wholesale?: boolean;
};

export type CartDraft = {
  version: 1;
  updatedAt: number;
  items: CartDraftItem[];
  note?: string;
  voucherCode?: string;
  shippingMethod?: "fast" | "express";
};

function text(value: unknown, limit: number) {
  return String(value || "").trim().slice(0, limit);
}

export function sanitizeCartDraft(value: unknown, now = Date.now()): CartDraft {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items = rawItems.slice(0, 60).map((rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
    return {
      productId: text(item.productId, 120),
      cartId: text(item.cartId, 240),
      classificationId: text(item.classificationId, 120) || undefined,
      classificationName: text(item.classificationName, 160) || undefined,
      classificationIndex: Math.max(0, Math.min(100, Math.floor(Number(item.classificationIndex) || 0))),
      color: text(item.color, 120) || undefined,
      size: text(item.size, 40) || undefined,
      quantity: Math.max(1, Math.min(999, Math.floor(Number(item.quantity) || 1))),
      inventoryKey: text(item.inventoryKey, 240) || undefined,
      sku: text(item.sku, 160) || undefined,
      pancakeSku: text(item.pancakeSku, 160) || undefined,
      pancakeProductId: text(item.pancakeProductId, 160) || undefined,
      pancakeVariationId: text(item.pancakeVariationId, 160) || undefined,
      message: text(item.message, 300) || undefined,
      wholesale: item.wholesale === true || undefined
    };
  }).filter((item) => item.productId && item.cartId);
  const requestedUpdatedAt = Math.floor(Number(source.updatedAt) || now);
  return {
    version: 1,
    updatedAt: Math.max(0, Math.min(requestedUpdatedAt, now + 5 * 60 * 1000)),
    items,
    note: text(source.note, 500) || undefined,
    voucherCode: text(source.voucherCode, 80) || undefined,
    shippingMethod: source.shippingMethod === "express" ? "express" : "fast"
  };
}

export async function readCartDraft(deviceId: string) {
  const draft = await readEphemeralJsonRecord<CartDraft>(cartDraftNamespace, deviceId);
  if (!draft || Date.now() - Number(draft.updatedAt || 0) > cartDraftTtlSeconds * 1000) return null;
  return draft;
}

export async function saveCartDraft(deviceId: string, value: unknown) {
  const draft = sanitizeCartDraft(value);
  return writeEphemeralJsonRecord(cartDraftNamespace, deviceId, draft, draft.updatedAt, cartDraftTtlSeconds);
}

export async function removeCartDraft(deviceId: string) {
  return deleteEphemeralJsonRecord(cartDraftNamespace, deviceId);
}
