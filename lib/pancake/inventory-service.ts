import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import type { PancakeAvailabilityItem } from "@/lib/pancake/types";
import { Validator } from "@/lib/pancake/validator";
import { availableQuantity, changePublishQuantity } from "@/lib/pancake/domain";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";
import type { OrderItem } from "@/lib/types";

export class InventoryService {
  constructor(private readonly pancake = new PancakeService()) {}

  configured() {
    return this.pancake.configured();
  }

  static available(publishQuantity: unknown, pancakeQuantity: unknown) {
    return availableQuantity(publishQuantity, pancakeQuantity);
  }

  async sync() {
    const variations = await this.pancake.variations();
    const byId = new Map(variations.map((item) => [item.id, item]));
    const bySku = new Map(variations.filter((item) => item.sku).map((item) => [item.sku.toUpperCase(), item]));
    const byProductId = new Map(variations.filter((item) => item.productId).map((item) => [item.productId, item]));
    const content = await readSiteContent();
    const now = new Date().toISOString();
    let linked = 0;
    const products = content.products.map((product) => ({
      ...product,
      inventory: buildProductInventory(product).map((item) => {
        const variation = (item.pancakeVariationId ? byId.get(item.pancakeVariationId) : undefined)
          || (item.pancakeSku ? bySku.get(item.pancakeSku.toUpperCase()) : undefined)
          || (item.pancakeProductId ? byProductId.get(item.pancakeProductId) : undefined);
        if (!variation) return item;
        linked += 1;
        return {
          ...item,
          pancakeProductId: item.pancakeProductId || variation.productId,
          pancakeVariationId: variation.id,
          pancakeSku: item.pancakeSku || variation.sku,
          pancakeQuantity: variation.quantity,
          quantity: variation.quantity,
          lastSyncedAt: now
        };
      })
    }));
    const saved = await writeSiteContent({ ...content, products });
    await PancakeLogger.write("info", "inventory.sync", `Đã đọc ${variations.length} biến thể Pancake, khớp ${linked} dòng website.`);
    return { content: saved, remoteCount: variations.length, linkedCount: linked, syncedAt: now };
  }

  async availability(productId?: string, refresh = false) {
    if (refresh && this.configured()) await this.sync();
    const content = await readSiteContent();
    const products = productId ? content.products.filter((product) => product.id === productId) : content.products;
    return products.flatMap((product) => buildProductInventory(product).map((item): PancakeAvailabilityItem & { productId: string } => {
      const linked = Boolean(item.pancakeVariationId || item.pancakeProductId || item.pancakeSku);
      return {
        productId: product.id,
        key: item.key,
        sku: item.sku,
        pancakeProductId: item.pancakeProductId || "",
        pancakeVariationId: item.pancakeVariationId || "",
        pancakeSku: item.pancakeSku || "",
        publishQuantity: Validator.quantity(item.publishQuantity),
        pancakeQuantity: Validator.quantity(item.pancakeQuantity),
        availableQuantity: linked ? InventoryService.available(item.publishQuantity, item.pancakeQuantity) : 0,
        linked,
        lastSyncedAt: item.lastSyncedAt
      };
    }));
  }

  async assertAvailable(items: OrderItem[]) {
    const linkedItems = items;
    if (!linkedItems.length) return;
    if (!this.configured()) throw new PancakeIntegrationError("Website chưa cấu hình API Pancake nên chưa thể kiểm tra tồn kho.", "PANCAKE_NOT_CONFIGURED", 503);
    await this.sync();
    const availability = await this.availability();
    for (const item of linkedItems) {
      const row = availability.find((candidate) =>
        (item.inventoryKey && candidate.key === item.inventoryKey)
        || (item.pancakeVariationId && candidate.pancakeVariationId === item.pancakeVariationId)
        || (item.pancakeSku && candidate.pancakeSku.toUpperCase() === item.pancakeSku.toUpperCase())
      );
      if (!row?.linked) throw new PancakeIntegrationError(`${item.name} chưa liên kết với Pancake.`, "PRODUCT_NOT_LINKED", 409);
      if (row.availableQuantity < item.quantity) {
        throw new PancakeIntegrationError(`${item.name} chỉ còn có thể bán ${row.availableQuantity} sản phẩm.`, "OUT_OF_STOCK", 409);
      }
    }
  }

  async reserve(items: OrderItem[], direction: "decrease" | "restore") {
    const content = await readSiteContent();
    const products = content.products.map((product) => ({
      ...product,
      inventory: buildProductInventory(product).map((row) => {
        const item = items.find((candidate) =>
          (candidate.productId === product.id && candidate.inventoryKey === row.key)
          || (candidate.pancakeVariationId && candidate.pancakeVariationId === row.pancakeVariationId)
          || (candidate.pancakeSku && candidate.pancakeSku.toUpperCase() === (row.pancakeSku || "").toUpperCase())
        );
        if (!item) return row;
        return { ...row, publishQuantity: changePublishQuantity(row.publishQuantity, item.quantity, direction) };
      })
    }));
    return writeSiteContent({ ...content, products });
  }
}
