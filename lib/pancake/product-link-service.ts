import { buildProductInventory } from "@/lib/product-inventory";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { Validator } from "@/lib/pancake/validator";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";

export type ProductLinkInput = {
  productId?: string;
  rowKey?: string;
  variationId?: string;
};

export class ProductLinkService {
  constructor(private readonly pancake = new PancakeService()) {}

  async variations() {
    return this.pancake.variations();
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
      const variation = (await this.pancake.variations()).find((item) => item.id === variationId);
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

    const confirmedContent = await readSiteContent();
    const confirmedProduct = confirmedContent.products.find((item) => item.id === productId);
    const confirmedRow = confirmedProduct
      ? buildProductInventory(confirmedProduct).find((item) => item.key === rowKey)
      : undefined;
    const confirmedLinked = Boolean(confirmedRow?.pancakeVariationId || confirmedRow?.pancakeProductId || confirmedRow?.pancakeSku);

    if (variationId && (!confirmedLinked || confirmedRow?.pancakeVariationId !== link.pancakeVariationId)) {
      throw new PancakeIntegrationError("Đã gửi yêu cầu nhưng chưa xác minh được dữ liệu liên kết sau khi lưu.", "PRODUCT_LINK_NOT_PERSISTED", 500);
    }
    if (!variationId && confirmedLinked) {
      throw new PancakeIntegrationError("Chưa xác minh được việc hủy liên kết sau khi lưu.", "PRODUCT_UNLINK_NOT_PERSISTED", 500);
    }

    await PancakeLogger.write(
      "info",
      variationId ? "product.link" : "product.unlink",
      variationId
        ? `Đã liên kết ${product.name} · ${target.size} với SKU ${link.pancakeSku || link.pancakeVariationId}.`
        : `Đã hủy liên kết ${product.name} · ${target.size}.`
    );

    return {
      productId,
      rowKey,
      linked: confirmedLinked,
      pancakeProductId: confirmedRow?.pancakeProductId || "",
      pancakeVariationId: confirmedRow?.pancakeVariationId || "",
      pancakeSku: confirmedRow?.pancakeSku || ""
    };
  }
}
