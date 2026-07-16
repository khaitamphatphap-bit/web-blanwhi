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
  for (const value of Object.values(record)) {
    const nested = records(value);
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

function deepText(record: Record<string, unknown>, keys: string[], depth = 0): string {
  const direct = text(record, keys);
  if (direct || depth >= 4) return direct;
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const found = deepText(item as Record<string, unknown>, keys, depth + 1);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      const found = deepText(value as Record<string, unknown>, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function deepContainsValue(value: unknown, expected: string, depth = 0): boolean {
  if (depth >= 5 || value === null || value === undefined) return false;
  if (typeof value !== "object") return String(value).trim().toUpperCase() === expected;
  return Object.values(value as Record<string, unknown>).some((nested) => deepContainsValue(nested, expected, depth + 1));
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type PancakeShippingPartner = {
  id: number;
  name: string;
  shopPartnerId?: number;
  accountName?: string;
};

export type PancakeGeoItem = {
  id: string;
  name: string;
  provinceId?: string;
  districtId?: string;
  newId?: string;
};

function variationName(item: Record<string, unknown>) {
  const product = nestedRecord(item.product);
  const productName = text(product, ["name", "display_name"]);
  const fields = Array.isArray(item.fields) ? item.fields : [];
  const fieldValues = fields
    .map((field) => text(nestedRecord(field), ["value", "keyValue"]))
    .filter(Boolean);
  return [text(item, ["name", "variation_name"]), productName, ...fieldValues]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");
}

let variationCache: { expiresAt: number; value: PancakeVariation[] } | null = null;
let variationRequest: Promise<PancakeVariation[]> | null = null;
let partnerCache: { expiresAt: number; value: PancakeShippingPartner[] } | null = null;
let partnerRequest: Promise<PancakeShippingPartner[]> | null = null;

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
    if (variationCache && variationCache.expiresAt > Date.now()) return variationCache.value;
    if (variationRequest) return variationRequest;
    variationRequest = (async () => {
      const response = await this.client.request<unknown>(`/shops/${encodeURIComponent(this.shopId())}/products/variations`, {
        query: { page_number: 1, page_size: 1000 }
      });
      const value = records(response).map((item) => ({
        id: text(item, ["id", "variation_id"]),
        productId: text(item, ["product_id", "productId"]),
        sku: text(item, ["custom_id", "sku", "product_code", "display_id"]).toUpperCase(),
        name: variationName(item),
        quantity: Validator.quantity(item.remain_quantity ?? item.quantity ?? item.inventory_quantity ?? item.total_quantity),
        raw: item
      })).filter((item) => item.id || item.sku);
      variationCache = { expiresAt: Date.now() + 5000, value };
      return value;
    })();
    try {
      return await variationRequest;
    } finally {
      variationRequest = null;
    }
  }

  async createOrder(order: ShopOrder) {
    order.items.forEach((item) => {
      if (!item.pancakeVariationId && !item.pancakeProductId && !item.pancakeSku) {
        throw new PancakeIntegrationError(`Sản phẩm ${item.name} chưa liên kết Pancake.`, "PRODUCT_NOT_LINKED", 409);
      }
    });
    const path = `/shops/${encodeURIComponent(this.shopId())}/orders`;
    const shippingPartner = order.deliveryType === "express" ? null : await this.viettelPostPartner().catch(() => {
      const id = Number(process.env.PANCAKE_VTP_PARTNER_ID || 0);
      const shopPartnerId = Number(process.env.PANCAKE_VTP_ACCOUNT_ID || 0);
      return id > 0 ? { id, name: "VTP", ...(shopPartnerId > 0 ? { shopPartnerId } : {}) } : null;
    });
    const payload = buildPancakeOrderPayload(order, this.shopId(), shippingPartner || undefined);
    return this.client.request<Record<string, unknown>>(path, { method: "POST", body: payload });
  }

  async shippingPartners(): Promise<PancakeShippingPartner[]> {
    if (partnerCache && partnerCache.expiresAt > Date.now()) return partnerCache.value;
    if (partnerRequest) return partnerRequest;
    partnerRequest = (async () => {
      const response = await this.client.request<unknown>(`/shops/${encodeURIComponent(this.shopId())}/partners`);
      const value = records(response).map((partner) => {
      const accounts = Array.isArray(partner.accounts)
        ? partner.accounts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
        : [];
      const preferredAccountId = String(process.env.PANCAKE_VTP_ACCOUNT_ID || "").trim();
      const account = accounts.find((item) => text(item, ["id"]) === preferredAccountId) || accounts[0];
      return {
        id: Number(text(partner, ["id", "partner_id"])) || 0,
        name: text(partner, ["name", "partner_name"]),
        ...(account ? { shopPartnerId: Number(text(account, ["id"])) || undefined, accountName: text(account, ["name"]) } : {})
      };
      }).filter((partner) => partner.id && partner.name);
      partnerCache = { expiresAt: Date.now() + 60_000, value };
      return value;
    })();
    try {
      return await partnerRequest;
    } finally {
      partnerRequest = null;
    }
  }

  async viettelPostPartner() {
    const partners = await this.shippingPartners();
    const configuredPartnerId = Number(process.env.PANCAKE_VTP_PARTNER_ID || 0);
    return partners.find((partner) => configuredPartnerId > 0 && partner.id === configuredPartnerId)
      || partners.find((partner) => /(^|\b)(vtp|viettel\s*post)(\b|$)/i.test(partner.name));
  }

  async provinces(): Promise<PancakeGeoItem[]> {
    const response = await this.client.request<unknown>("/geo/provinces", { query: { country_code: "84", is_new: "false" } });
    return records(response).map((item) => ({
      id: text(item, ["id"]),
      name: text(item, ["name"]),
      newId: text(item, ["new_id"])
    })).filter((item) => item.id && item.name);
  }

  async districts(provinceId: string): Promise<PancakeGeoItem[]> {
    const id = Validator.required(provinceId, "tỉnh/thành phố");
    const response = await this.client.request<unknown>("/geo/districts", { query: { province_id: id } });
    return records(response).map((item) => ({
      id: text(item, ["id"]),
      name: text(item, ["name"]),
      provinceId: text(item, ["province_id"])
    })).filter((item) => item.id && item.name);
  }

  async communes(provinceId: string, districtId: string): Promise<PancakeGeoItem[]> {
    const province = Validator.required(provinceId, "tỉnh/thành phố");
    const district = Validator.required(districtId, "quận/huyện");
    const response = await this.client.request<unknown>("/geo/communes", { query: { province_id: province, district_id: district } });
    return records(response).map((item) => ({
      id: text(item, ["id"]),
      name: text(item, ["name"]),
      provinceId: text(item, ["province_id"]),
      districtId: text(item, ["district_id"]),
      newId: text(item, ["new_id"])
    })).filter((item) => item.id && item.name);
  }

  async cancelOrder(providerOrderId: string) {
    const id = Validator.required(providerOrderId, "Pancake Order ID");
    return this.client.request<Record<string, unknown>>(`/shops/${encodeURIComponent(this.shopId())}/orders/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: { status: 6 }
    });
  }

  async orders(search = "") {
    return this.client.request<unknown>(`/shops/${encodeURIComponent(this.shopId())}/orders`, {
      query: { page_number: 1, page_size: 100, search: search || undefined }
    });
  }

  async findOrder(orderCode: string, customerPhone = "") {
    const expected = orderCode.trim().toUpperCase();
    const searches = [...new Set([orderCode.trim(), customerPhone.trim(), ""].filter((value, index) => value || index === 2))];
    for (const search of searches) {
      const match = records(await this.orders(search)).find((item) => {
        const partnerCode = deepText(item, ["custom_id", "partner_order_id", "order_code", "code"]).toUpperCase();
        const externalCode = deepText(item, ["external_order_id"]).replace(/^BLANWHI:/i, "").toUpperCase();
        return partnerCode === expected || externalCode === expected || deepContainsValue(item, expected);
      });
      if (match) return match;
    }
    return null;
  }
}
