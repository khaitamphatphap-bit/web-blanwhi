import type { CmsProduct, CmsProductInventoryItem } from "@/lib/site-content";

function inventoryKey(classificationId: string, color: string, size: string) {
  return [classificationId || "product", color || "default", size || "one-size"].join("|");
}

function defaultInventorySku(productId: string, classificationId: string, color: string, size: string) {
  return [productId, classificationId, color, size]
    .filter(Boolean)
    .join("-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export function buildProductInventory(product: CmsProduct): CmsProductInventoryItem[] {
  const savedByKey = new Map((product.inventory || []).map((item) => [item.key, item]));
  const sizes = product.sizes?.length ? product.sizes : ["ONE SIZE"];
  const variants = product.classifications?.length
    ? product.classifications.flatMap((classification) => {
        const colors = classification.swatches?.length ? classification.swatches : [""];
        return colors.map((color) => ({ classificationId: classification.id, color }));
      })
    : (product.swatches?.length ? product.swatches : [""]).map((color) => ({ classificationId: "", color }));

  return variants.flatMap(({ classificationId, color }) => sizes.map((size) => {
    const key = inventoryKey(classificationId, color, size);
    const saved = savedByKey.get(key);
    return {
      key,
      sku: saved?.sku || defaultInventorySku(product.id, classificationId, color, size),
      quantity: Math.max(0, Math.floor(Number(saved?.quantity) || 0)),
      publishQuantity: Math.max(0, Math.floor(Number(saved?.publishQuantity) || 0)),
      pancakeQuantity: Math.max(0, Math.floor(Number(saved?.pancakeQuantity ?? saved?.quantity) || 0)),
      pancakeProductId: String(saved?.pancakeProductId || ""),
      pancakeVariationId: String(saved?.pancakeVariationId || ""),
      pancakeSku: String(saved?.pancakeSku || ""),
      ...(saved?.lastSyncedAt ? { lastSyncedAt: saved.lastSyncedAt } : {}),
      size,
      ...(color ? { color } : {}),
      ...(classificationId ? { classificationId } : {})
    };
  }));
}
