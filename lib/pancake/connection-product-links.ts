import { readJsonStore, withDataStoreLock, writeJsonStore } from "@/lib/data-store";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent, writePancakeProductLink, type SiteContent } from "@/lib/site-content";
import type { OrderItem, ShopOrder } from "@/lib/types";
import type { PancakeConnectionId } from "@/lib/pancake/connection-routing";

export type ConnectionProductLink = {
  pancakeProductId: string;
  pancakeVariationId: string;
  pancakeSku: string;
  pancakeQuantity: number;
  lastSyncedAt?: string;
};

const shop2Store = "pancake-links-shop-2.json";

export function connectionProductLinkKey(productId: string, rowKey: string) {
  return `${String(productId).trim()}::${String(rowKey).trim()}`;
}

function linkFromRow(row: ReturnType<typeof buildProductInventory>[number]): ConnectionProductLink {
  return {
    pancakeProductId: String(row.pancakeProductId || ""),
    pancakeVariationId: String(row.pancakeVariationId || ""),
    pancakeSku: String(row.pancakeSku || ""),
    pancakeQuantity: Math.max(0, Math.floor(Number(row.pancakeQuantity) || 0)),
    ...(row.lastSyncedAt ? { lastSyncedAt: row.lastSyncedAt } : {})
  };
}

export async function readConnectionProductLinks(id: PancakeConnectionId, content?: SiteContent) {
  if (id === "shop-2") return readJsonStore<Record<string, ConnectionProductLink>>(shop2Store, {});
  const current = content || await readSiteContent();
  return Object.fromEntries(current.products.flatMap((product) => buildProductInventory(product).map((row) => [
    connectionProductLinkKey(product.id, row.key),
    linkFromRow(row)
  ])));
}

export async function writeConnectionProductLink(
  id: PancakeConnectionId,
  productId: string,
  rowKey: string,
  link: ConnectionProductLink
) {
  if (id === "shop-1") return writePancakeProductLink(productId, rowKey, link);
  return withDataStoreLock("pancake-links-shop-2", async () => {
    const current = await readConnectionProductLinks("shop-2");
    const key = connectionProductLinkKey(productId, rowKey);
    const next = { ...current };
    if (link.pancakeProductId || link.pancakeVariationId || link.pancakeSku) next[key] = link;
    else delete next[key];
    await writeJsonStore(shop2Store, next);
    return link;
  });
}

export async function writeConnectionProductLinks(
  id: PancakeConnectionId,
  links: Record<string, ConnectionProductLink>
) {
  if (id !== "shop-2") throw new Error("Chỉ hỗ trợ ghi liên kết hàng loạt cho Pancake Shop 2.");
  return withDataStoreLock("pancake-links-shop-2", async () => {
    const current = await readConnectionProductLinks("shop-2");
    const next = { ...current, ...links };
    await writeJsonStore(shop2Store, next);
    const persisted = await readConnectionProductLinks("shop-2");
    for (const [key, link] of Object.entries(links)) {
      if (persisted[key]?.pancakeVariationId !== link.pancakeVariationId
        || persisted[key]?.pancakeProductId !== link.pancakeProductId
        || persisted[key]?.pancakeSku !== link.pancakeSku) {
        throw new Error(`Liên kết Shop 2 chưa được lưu bền vững: ${key}`);
      }
    }
    return links;
  });
}

export async function productsForPancakeConnection(content: SiteContent, id: PancakeConnectionId) {
  const links = await readConnectionProductLinks(id, content);
  return content.products.map((product) => ({
    id: product.id,
    name: product.name,
    rows: buildProductInventory(product).map((row) => ({
      ...row,
      ...(id === "shop-2" ? links[connectionProductLinkKey(product.id, row.key)] : {}),
      linked: id === "shop-2"
        ? Boolean(links[connectionProductLinkKey(product.id, row.key)]?.pancakeProductId
          || links[connectionProductLinkKey(product.id, row.key)]?.pancakeVariationId
          || links[connectionProductLinkKey(product.id, row.key)]?.pancakeSku)
        : Boolean(row.pancakeProductId || row.pancakeVariationId || row.pancakeSku)
    }))
  }));
}

function matchesOrderItem(item: OrderItem, productId: string, row: ReturnType<typeof buildProductInventory>[number]) {
  return item.productId === productId && Boolean(
    (item.inventoryKey && item.inventoryKey === row.key)
    || (item.sku && item.sku.trim().toUpperCase() === row.sku.trim().toUpperCase())
  );
}

export async function applyConnectionProductLinks(order: ShopOrder, id: PancakeConnectionId) {
  if (id === "shop-1" && order.items.every((item) => item.pancakeVariationId || item.pancakeProductId || item.pancakeSku)) return order;
  const content = await readSiteContent();
  const links = await readConnectionProductLinks(id, content);
  const rows = content.products.flatMap((product) => buildProductInventory(product).map((row) => ({ productId: product.id, row })));
  const items = order.items.map((item) => {
    const match = rows.find(({ productId, row }) => matchesOrderItem(item, productId, row));
    if (!match) return item;
    const link = links[connectionProductLinkKey(match.productId, match.row.key)];
    return {
      ...item,
      pancakeProductId: link?.pancakeProductId || undefined,
      pancakeVariationId: link?.pancakeVariationId || undefined,
      pancakeSku: link?.pancakeSku || undefined
    };
  });
  return { ...order, items };
}
