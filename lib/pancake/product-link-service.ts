import { buildProductInventory } from "@/lib/product-inventory";
import { readJsonStoreHistory } from "@/lib/data-store";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { Validator } from "@/lib/pancake/validator";
import { readSiteContent, writePancakeProductLink, type SiteContent } from "@/lib/site-content";
import {
  connectionProductLinkKey,
  readConnectionProductLinks,
  writeConnectionProductLink,
  writeConnectionProductLinks
} from "@/lib/pancake/connection-product-links";
import { setPancakeProductSyncState } from "@/lib/pancake/connections";

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

export type BulkProductLinkInput = {
  links?: Array<{
    productId?: string;
    rowKey?: string;
    variationId?: string;
    variation?: { id?: string; productId?: string; sku?: string; quantity?: number };
  }>;
};

export class ProductLinkService {
  constructor(private readonly pancake = new PancakeService()) {}

  private async refreshProductSyncState(message: string) {
    const connectionId = this.pancake.connectionId();
    const content = await readSiteContent();
    const links = await readConnectionProductLinks(connectionId, content);
    const rows = content.products.flatMap((product) => buildProductInventory(product).map((row) => ({ productId: product.id, row })));
    const linkedCount = rows.filter(({ productId, row }) => {
      const link = links[connectionProductLinkKey(productId, row.key)];
      return Boolean(link?.pancakeProductId || link?.pancakeVariationId || link?.pancakeSku);
    }).length;
    await setPancakeProductSyncState(connectionId, {
      status: linkedCount === rows.length && rows.length > 0 ? "ready" : "running",
      linkedCount,
      totalCount: rows.length,
      lastSyncedAt: new Date().toISOString(),
      message
    });
    return { linkedCount, totalCount: rows.length };
  }

  async variations() {
    return this.pancake.variations();
  }

  async updateMany(input: BulkProductLinkInput) {
    if (this.pancake.connectionId() !== "shop-2") {
      throw new PancakeIntegrationError("Ghi liên kết hàng loạt chỉ dành cho Pancake Shop 2.", "INVALID_CONNECTION", 400);
    }
    const requested = Array.isArray(input.links) ? input.links : [];
    if (!requested.length || requested.length > 1000) {
      throw new PancakeIntegrationError("Danh sách liên kết Shop 2 không hợp lệ.", "VALIDATION_ERROR", 400);
    }
    const content = await readSiteContent();
    const products = new Map(content.products.map((product) => [product.id, product]));
    const next: Record<string, {
      pancakeProductId: string;
      pancakeVariationId: string;
      pancakeSku: string;
      pancakeQuantity: number;
      lastSyncedAt: string;
    }> = {};
    const now = new Date().toISOString();
    for (const item of requested) {
      const productId = Validator.required(item.productId, "mã sản phẩm website");
      const rowKey = Validator.required(item.rowKey, "dòng phân loại/màu/size");
      const variationId = Validator.required(item.variationId, "mã phân loại Pancake");
      const product = products.get(productId);
      if (!product || !buildProductInventory(product).some((row) => row.key === rowKey)) {
        throw new PancakeIntegrationError(`Không tìm thấy dòng sản phẩm ${productId}/${rowKey}.`, "INVENTORY_ROW_NOT_FOUND", 404);
      }
      if (item.variation?.id !== variationId || !item.variation.productId || !item.variation.sku) {
        throw new PancakeIntegrationError(`Thiếu dữ liệu phân loại Pancake cho ${productId}/${rowKey}.`, "VALIDATION_ERROR", 400);
      }
      const key = connectionProductLinkKey(productId, rowKey);
      if (next[key]) throw new PancakeIntegrationError(`Liên kết bị trùng: ${key}.`, "VALIDATION_ERROR", 400);
      next[key] = {
        pancakeProductId: String(item.variation.productId),
        pancakeVariationId: variationId,
        pancakeSku: String(item.variation.sku).toUpperCase(),
        pancakeQuantity: Validator.quantity(item.variation.quantity),
        lastSyncedAt: now
      };
    }
    await writeConnectionProductLinks("shop-2", next);
    const sync = await this.refreshProductSyncState(`Đã lưu an toàn ${requested.length} liên kết sản phẩm Shop 2 trong một giao dịch.`);
    return { updatedCount: requested.length, ...sync };
  }

  async recoverLinks() {
    if (this.pancake.connectionId() === "shop-2") {
      const [content, variations] = await Promise.all([readSiteContent(), this.pancake.variations()]);
      const remoteBySku = new Map<string, typeof variations>();
      variations.filter((variation) => variation.sku).forEach((variation) => {
        const sku = variation.sku.trim().toUpperCase();
        remoteBySku.set(sku, [...(remoteBySku.get(sku) || []), variation]);
      });
      const websiteSkuCount = new Map<string, number>();
      content.products.forEach((product) => buildProductInventory(product).forEach((row) => {
        const sku = row.sku.trim().toUpperCase();
        websiteSkuCount.set(sku, (websiteSkuCount.get(sku) || 0) + 1);
      }));
      let recoveredCount = 0;
      for (const product of content.products) {
        for (const row of buildProductInventory(product)) {
          const sku = row.sku.trim().toUpperCase();
          const candidates = remoteBySku.get(sku) || [];
          const variation = websiteSkuCount.get(sku) === 1 && candidates.length === 1 ? candidates[0] : undefined;
          if (!variation) continue;
          await writeConnectionProductLink("shop-2", product.id, row.key, {
            pancakeProductId: variation.productId,
            pancakeVariationId: variation.id,
            pancakeSku: variation.sku,
            pancakeQuantity: variation.quantity,
            lastSyncedAt: new Date().toISOString()
          });
          recoveredCount += 1;
        }
      }
      const sync = await this.refreshProductSyncState(`Đã đối chiếu ${recoveredCount} SKU Shop 2 theo mã SKU.`);
      return { recoveredCount, scannedBackups: 0, availablePancakeVariations: variations.length, ...sync };
    }
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
    const candidatesByWebSku = new Map<string, (typeof variations)[number]>();

    for (const snapshot of history) {
      if (!Array.isArray(snapshot.products)) continue;
      for (const historicalProduct of snapshot.products) {
        if (!historicalProduct?.id || !currentProducts.has(historicalProduct.id)) continue;
        const historicalRows = Array.isArray(historicalProduct.inventory)
          ? historicalProduct.inventory
          : buildProductInventory(historicalProduct);
        for (const row of historicalRows) {
          const candidateKey = `${historicalProduct.id}::${row.key}`;
          const variation = (row.pancakeVariationId && variationById.get(row.pancakeVariationId))
            || (row.pancakeSku && variationBySku.get(row.pancakeSku.trim().toUpperCase()));
          if (!variation) continue;
          if (!candidates.has(candidateKey)) candidates.set(candidateKey, variation);
          const webSku = String(row.sku || "").trim().toUpperCase();
          const skuKey = `${historicalProduct.id}::${webSku}`;
          if (webSku && !candidatesByWebSku.has(skuKey)) candidatesByWebSku.set(skuKey, variation);
        }
      }
    }

    const recovered: Array<{ productId: string; rowKey: string; link: {
      pancakeProductId: string;
      pancakeVariationId: string;
      pancakeSku: string;
      pancakeQuantity: number;
      lastSyncedAt: string;
    } }> = [];
    const recoveredAt = new Date().toISOString();
    content.products.forEach((product) => {
      buildProductInventory(product).forEach((row) => {
        const alreadyLinked = Boolean(row.pancakeProductId || row.pancakeVariationId || row.pancakeSku);
        const variation = candidates.get(`${product.id}::${row.key}`)
          || candidatesByWebSku.get(`${product.id}::${row.sku.trim().toUpperCase()}`);
        if (alreadyLinked || !variation) return;
        recovered.push({
          productId: product.id,
          rowKey: row.key,
          link: {
          pancakeProductId: variation.productId,
          pancakeVariationId: variation.id,
          pancakeSku: variation.sku,
          pancakeQuantity: variation.quantity,
          lastSyncedAt: recoveredAt
          }
        });
      });
    });

    await Promise.all(recovered.map((item) => writePancakeProductLink(item.productId, item.rowKey, item.link)));
    return {
      recoveredCount: recovered.length,
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

    const connectionId = this.pancake.connectionId();
    if (connectionId === "shop-1") await writePancakeProductLink(productId, rowKey, link);
    else await writeConnectionProductLink(connectionId, productId, rowKey, link);

    const persistedLinks = await readConnectionProductLinks(connectionId);
    const persistedLink = persistedLinks[connectionProductLinkKey(productId, rowKey)];
    if (String(persistedLink?.pancakeVariationId || "") !== String(link.pancakeVariationId || "")
      || String(persistedLink?.pancakeSku || "") !== String(link.pancakeSku || "")) {
      throw new PancakeIntegrationError(
        "Liên kết chưa được lưu bền vững. Vui lòng thử lại.",
        "PANCAKE_LINK_VERIFY_FAILED",
        503
      );
    }
    await this.refreshProductSyncState(variationId ? "Đã cập nhật liên kết sản phẩm." : "Đã hủy một liên kết sản phẩm.");

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
