import { buildProductInventory } from "@/lib/product-inventory";
import { readJsonStoreHistory } from "@/lib/data-store";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { Validator } from "@/lib/pancake/validator";
import { readSiteContent, writeSiteContent, type SiteContent } from "@/lib/site-content";

export type ProductLinkInput = {
  productId?: string;
  rowKey?: string;
  variationId?: string;
  variation?: {
    id?: string;
    productId?: string;
    sku?: string;
    quantity?: number;
  };
};

export class ProductLinkService {
  constructor(private readonly pancake = new PancakeService()) {}

  async variations() {
    return this.pancake.variations();
  }

  async recoverLinks() {
    const [content, history, variations] = await Promise.all([
      readSiteContent(),
      readJsonStoreHistory<Partial<SiteContent>>("site-content.json", 250),
      this.pancake.variations()
    ]);
    const currentProducts = new Map(content.products.map((product) => [product.id, product]));
    const variationById = new Map(variations.map((variation) => [variation.id, variation]));
    const variationBySku = new Map(
      variations
        .filter((variation) => variation.sku)
        .map((variation) => [variation.sku.trim().toUpperCase(), variation])
    );
    const candidates = new Map<string, (typeof variations)[number]>();

    for (const snapshot of history) {
      if (!Array.isArray(snapshot.products)) continue;
      for (const historicalProduct of snapshot.products) {
        if (!historicalProduct?.id || !currentProducts.has(historicalProduct.id)) continue;
        for (const row of buildProductInventory(historicalProduct)) {
          const candidateKey = `${historicalProduct.id}::${row.key}`;
          if (candidates.has(candidateKey)) continue;
          const variation = (row.pancakeVariationId && variationById.get(row.pancakeVariationId))
            || (row.pancakeSku && variationBySku.get(row.pancakeSku.trim().toUpperCase()));
          if (variation) candidates.set(candidateKey, variation);
        }
      }
    }

    let recoveredCount = 0;
    const recoveredAt = new Date().toISOString();
    const products = content.products.map((product) => ({
      ...product,
      inventory: buildProductInventory(product).map((row) => {
        const alreadyLinked = Boolean(row.pancakeProductId || row.pancakeVariationId || row.pancakeSku);
        const variation = candidates.get(`${product.id}::${row.key}`);
        if (alreadyLinked || !variation) return row;
        recoveredCount += 1;
        return {
          ...row,
          pancakeProductId: variation.productId,
          pancakeVariationId: variation.id,
          pancakeSku: variation.sku,
          pancakeQuantity: variation.quantity,
          lastSyncedAt: recoveredAt
        };
      })
    }));

    if (recoveredCount > 0) await writeSiteContent({ ...content, products });
    return {
      recoveredCount,
      scannedBackups: history.length,
      availablePancakeVariations: variations.length
    };
  }

  async update(input: ProductLinkInput) {
    const productId = Validator.required(input.productId, "mã sản phẩm website");
    const rowKey = Validator.required(input.rowKey, "dòng phân loại/màu/size");
    const variationId = String(input.variationId || "").trim();
    const content = await readSiteContent();
    const product = content.products.find((item) => item.id === productId);

    if (!product) {
      throw new PancakeIntegrationError("Không tìm thấy sản phẩm website.", "PRODUCT_NOT_FOUND", 404);
    }

    const inventory = buildProductInventory(product);
    const target = inventory.find((item) => item.key === rowKey);
    if (!target) {
      throw new PancakeIntegrationError("Không tìm thấy phân loại, màu hoặc size cần liên kết.", "INVENTORY_ROW_NOT_FOUND", 404);
    }

    let link = {
      pancakeProductId: "",
      pancakeVariationId: "",
      pancakeSku: "",
      pancakeQuantity: 0,
      lastSyncedAt: undefined as string | undefined
    };

    if (variationId) {
      const suppliedVariation = input.variation?.id === variationId
        ? {
            id: variationId,
            productId: String(input.variation.productId || ""),
            sku: String(input.variation.sku || "").toUpperCase(),
            quantity: Validator.quantity(input.variation.quantity)
          }
        : null;
      const variation = suppliedVariation || (await this.pancake.variations()).find((item) => item.id === variationId);
      if (!variation) {
        throw new PancakeIntegrationError("Biến thể Pancake đã chọn không còn tồn tại.", "PANCAKE_VARIATION_NOT_FOUND", 404);
      }
      link = {
        pancakeProductId: variation.productId,
        pancakeVariationId: variation.id,
        pancakeSku: variation.sku,
        pancakeQuantity: variation.quantity,
        lastSyncedAt: new Date().toISOString()
      };
    }

    const products = content.products.map((item) => item.id === productId
      ? {
          ...item,
          inventory: inventory.map((inventoryItem) => inventoryItem.key === rowKey
            ? { ...inventoryItem, ...link }
            : inventoryItem)
        }
      : item);

    await writeSiteContent({ ...content, products });

    return {
      productId,
      rowKey,
      linked: Boolean(variationId),
      pancakeProductId: link.pancakeProductId,
      pancakeVariationId: link.pancakeVariationId,
      pancakeSku: link.pancakeSku,
      pancakeQuantity: link.pancakeQuantity,
      lastSyncedAt: link.lastSyncedAt
    };
  }
}
