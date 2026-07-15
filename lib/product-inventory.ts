import type { CmsProduct, CmsProductInventoryItem } from "@/lib/site-content";

function inventoryKey(classificationId: string, color: string, size: string) {
  return [classificationId || "product", color || "default", size || "one-size"].join("|");
}

function cleanInventorySku(parts: string[]) {
  return parts
    .filter(Boolean)
    .join("-")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function looksLikeInternalSku(sku: string, productId: string) {
  const value = sku.toUpperCase();
  return value.includes(productId.toUpperCase()) || /(?:VARIANT|CLASSIFICATION)-\d+/.test(value);
}

function defaultInventorySku(product: CmsProduct, classificationId: string, color: string, colorIndex: number, size: string) {
  const classification = product.classifications?.find((item) => item.id === classificationId);
  const classificationName = classification?.name?.trim() || "";
  const colorName = (classification?.colorNames?.[color] || product.colorNames?.[color] || (color ? `MÀU ${colorIndex + 1}` : "")).trim();
  const labels = [classificationName, colorName, size].filter(Boolean);
  return cleanInventorySku(labels.length > 1 ? labels : [product.name, ...labels]);
}

export function buildProductInventory(product: CmsProduct): CmsProductInventoryItem[] {
  const savedByKey = new Map((product.inventory || []).map((item) => [item.key, item]));
  const sizes = product.sizes?.length ? product.sizes : ["ONE SIZE"];
  const variants = product.classifications?.length
    ? product.classifications.flatMap((classification) => {
        const colors = classification.swatches?.length ? classification.swatches : [""];
        return colors.map((color, colorIndex) => ({ classificationId: classification.id, color, colorIndex }));
      })
    : (product.swatches?.length ? product.swatches : [""]).map((color, colorIndex) => ({ classificationId: "", color, colorIndex }));

  return variants.flatMap(({ classificationId, color, colorIndex }) => sizes.map((size) => {
    const key = inventoryKey(classificationId, color, size);
    const saved = savedByKey.get(key);
    const generatedSku = defaultInventorySku(product, classificationId, color, colorIndex, size);
    const savedSku = String(saved?.sku || "").trim();
    return {
      key,
      sku: savedSku && !looksLikeInternalSku(savedSku, product.id) ? savedSku : generatedSku,
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
