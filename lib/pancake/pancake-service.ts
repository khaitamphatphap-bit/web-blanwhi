import type { ShopOrder } from "@/lib/types";
import { ApiClient } from "@/lib/pancake/api-client";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import type { PancakeVariation } from "@/lib/pancake/types";
import { Validator } from "@/lib/pancake/validator";
import { buildPancakeOrderPayload } from "@/lib/pancake/domain";

function records(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["shops", "variations", "data", "products", "items", "orders"]) {
    const nested = records(record[key]);
    if (nested.length) return nested;
  }
  return [];
}

function text(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export class PancakeService {
  constructor(private readonly client = new ApiClient()) {}

  configured() {
    return this.client.configured() && Boolean(process.env.PANCAKE_SHOP_ID);
  }

  shopId() {
    return Validator.required(process.env.PANCAKE_SHOP_ID, "PANCAKE_SHOP_ID");
  }

  async testConnection() {
    const response = await this.client.request<Record<string, unknown>>("/shops");
    const shops = records(response);
    const shopId = this.shopId();
    const shop = shops.find((item) => text(item, ["id"]) === shopId);
    return { ok: true, shopId, shopName: shop ? text(shop, ["name"]) : "Đã kết nối API, chưa xác minh tên shop" };
  }

  async variations(): Promise<PancakeVariation[]> {
    const response = await this.client.request<unknown>(`/shops/${encodeURIComponent(this.shopId())}/products/variations`, {
      query: { page_number: 1, page_size: 1000 }
    });
    return records(response).map((item) => ({
      id: text(item, ["id", "variation_id"]),
      productId: text(item, ["product_id", "productId"]),
      sku: text(item, ["custom_id", "sku", "product_code", "display_id"]).toUpperCase(),
      name: text(item, ["name", "product_name", "display_name"]),
      quantity: Validator.quantity(item.remain_quantity ?? item.quantity ?? item.inventory_quantity ?? item.total_quantity),
      raw: item
    })).filter((item) => item.id || item.sku);
  }

  async createOrder(order: ShopOrder) {
    order.items.forEach((item) => {
      if (!item.pancakeVariationId && !item.pancakeProductId && !item.pancakeSku) {
        throw new PancakeIntegrationError(`Sản phẩm ${item.name} chưa liên kết Pancake.`, "PRODUCT_NOT_LINKED", 409);
      }
    });
    return this.client.request<Record<string, unknown>>(`/shops/${encodeURIComponent(this.shopId())}/orders`, {
      method: "POST",
      body: buildPancakeOrderPayload(order)
    });
  }

  async orders() {
    return this.client.request<unknown>(`/shops/${encodeURIComponent(this.shopId())}/orders`, {
      query: { page_number: 1, page_size: 100 }
    });
  }

  async findOrder(orderCode: string) {
    const expected = orderCode.trim().toUpperCase();
    return records(await this.orders()).find((item) => {
      const partnerCode = text(item, ["partner_order_id", "order_code", "code"]).toUpperCase();
      const externalCode = text(item, ["external_order_id"]).replace(/^BLANWHI:/i, "").toUpperCase();
      return partnerCode === expected || externalCode === expected;
    }) || null;
  }
}
