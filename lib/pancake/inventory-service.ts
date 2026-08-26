import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import type { PancakeAvailabilityItem } from "@/lib/pancake/types";
import { Validator } from "@/lib/pancake/validator";
import { availableQuantity, changePublishQuantity } from "@/lib/pancake/domain";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";
import type { OrderItem } from "@/lib/types";

function sameProduct(item: OrderItem, row: PancakeAvailabilityItem & { productId: string }) {
  return !item.productId || item.productId === row.productId;
}

function matchesAvailabilityRow(item: OrderItem, row: PancakeAvailabilityItem & { productId: string }) {
  if (!sameProduct(item, row)) return false;
  return Boolean(
    (item.inventoryKey && row.key === item.inventoryKey)
    || (item.pancakeVariationId && row.pancakeVariationId === item.pancakeVariationId)
    || (item.pancakeSku && row.pancakeSku.toUpperCase() === item.pancakeSku.toUpperCase())
  );
}

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
    const variations = refresh && this.configured() ? await this.pancake.variations() : [];
    const byId = new Map(variations.map((item) => [item.id, item]));
    const bySku = new Map(variations.filter((item) => item.sku).map((item) => [item.sku.toUpperCase(), item]));
    const byProductId = new Map(variations.filter((item) => item.productId).map((item) => [item.productId, item]));
    const content = await readSiteContent();
    const products = productId ? content.products.filter((product) => product.id === productId) : content.products;
    return products.flatMap((product) => buildProductInventory(product).map((item): PancakeAvailabilityItem & { productId: string } => {
      const linked = Boolean(item.pancakeVariationId || item.pancakeProductId || item.pancakeSku);
      const variation = (item.pancakeVariationId ? byId.get(item.pancakeVariationId) : undefined)
        || (item.pancakeSku ? bySku.get(item.pancakeSku.toUpperCase()) : undefined)
        || (item.pancakeProductId ? byProductId.get(item.pancakeProductId) : undefined);
      const pancakeQuantity = variation ? Validator.quantity(variation.quantity) : Validator.quantity(item.pancakeQuantity);
      return {
        productId: product.id,
        key: item.key,
        sku: item.sku,
        pancakeProductId: item.pancakeProductId || variation?.productId || "",
        pancakeVariationId: item.pancakeVariationId || variation?.id || "",
        pancakeSku: item.pancakeSku || variation?.sku || "",
        publishQuantity: Validator.quantity(item.publishQuantity),
        pancakeQuantity,
        availableQuantity: InventoryService.available(item.publishQuantity, pancakeQuantity),
        linked,
        lastSyncedAt: variation ? new Date().toISOString() : item.lastSyncedAt
      };
    }));
  }

  async assertAvailable(items: OrderItem[]) {
    if (!items.length) return;
    const availability = await this.availability(undefined, this.configured());
    const requested = new Map<string, { row: PancakeAvailabilityItem & { productId: string }; quantity: number; name: string }>();
    for (const item of items) {
      const row = availability.find((candidate) => matchesAvailabilityRow(item, candidate));
      if (!row) throw new PancakeIntegrationError(`${item.name} chưa có dòng tồn kho trên website.`, "PRODUCT_NOT_LINKED", 409);
      const requestKey = `${row.productId}::${row.key}`;
      const current = requested.get(requestKey);
      requested.set(requestKey, {
        row,
        quantity: (current?.quantity || 0) + Math.max(0, Math.floor(Number(item.quantity) || 0)),
        name: current?.name || item.name
      });
    }
    for (const request of requested.values()) {
      if (request.row.availableQuantity < request.quantity) {
        throw new PancakeIntegrationError(`${request.name} chỉ còn có thể bán ${request.row.availableQuantity} sản phẩm.`, "OUT_OF_STOCK", 409);
      }
    }
  }

  async reserve(items: OrderItem[], direction: "decrease" | "restore") {
    const content = await readSiteContent();
    const products = content.products.map((product) => ({
      ...product,
      inventory: buildProductInventory(product).map((row) => {
        const matchedItems = items.filter((candidate) =>
          (candidate.productId === product.id && candidate.inventoryKey === row.key)
          || (candidate.productId === product.id && candidate.pancakeVariationId && candidate.pancakeVariationId === row.pancakeVariationId)
          || (candidate.productId === product.id && candidate.pancakeSku && candidate.pancakeSku.toUpperCase() === (row.pancakeSku || "").toUpperCase())
        );
        if (!matchedItems.length) return row;
        const quantity = matchedItems.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)), 0);
        return { ...row, publishQuantity: changePublishQuantity(row.publishQuantity, quantity, direction) };
      })
    }));
    return writeSiteContent({ ...content, products });
  }
}
