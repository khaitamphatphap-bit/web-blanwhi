import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import type { PancakeAvailabilityItem } from "@/lib/pancake/types";
import { Validator } from "@/lib/pancake/validator";
import { availableQuantity, changePublishQuantity } from "@/lib/pancake/domain";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent, writeSiteContent } from "@/lib/site-content";
import { createOrder, findOrderByCheckoutRequestId, findOrderByCode, updateOrder } from "@/lib/orders";
import { withDataStoreLock } from "@/lib/data-store";
import type { OrderItem, ShopOrder } from "@/lib/types";

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
    const now = new Date().toISOString();
    let linked = 0;
    const saved = await withDataStoreLock("website-inventory", async () => {
      const content = await readSiteContent();
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
      return writeSiteContent({ ...content, products });
    });
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
    const availability = await this.availability(undefined, false);
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

  private async reserveUnlocked(items: OrderItem[], direction: "decrease" | "restore") {
    const content = await readSiteContent();
    const matched = new Set<number>();
    const products = content.products.map((product) => ({
      ...product,
      inventory: buildProductInventory(product).map((row) => {
        const matchedItems = items.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) =>
          (candidate.productId === product.id && candidate.inventoryKey === row.key)
          || (candidate.productId === product.id && candidate.pancakeVariationId && candidate.pancakeVariationId === row.pancakeVariationId)
          || (candidate.productId === product.id && candidate.pancakeSku && candidate.pancakeSku.toUpperCase() === (row.pancakeSku || "").toUpperCase())
        );
        if (!matchedItems.length) return row;
        matchedItems.forEach(({ index }) => matched.add(index));
        const quantity = matchedItems.reduce((sum, { candidate }) => sum + Math.max(0, Math.floor(Number(candidate.quantity) || 0)), 0);
        if (direction === "decrease" && changePublishQuantity(row.publishQuantity, quantity, direction) !== Number(row.publishQuantity) - quantity) {
          throw new PancakeIntegrationError(`${matchedItems[0].candidate.name} không còn đủ tồn kho để đặt.`, "OUT_OF_STOCK", 409);
        }
        return { ...row, publishQuantity: changePublishQuantity(row.publishQuantity, quantity, direction) };
      })
    }));
    if (matched.size !== items.length) {
      const missing = items.find((_, index) => !matched.has(index));
      throw new PancakeIntegrationError(`${missing?.name || "Sản phẩm"} chưa khớp phân loại tồn kho trên website.`, "PRODUCT_NOT_LINKED", 409);
    }
    return writeSiteContent({ ...content, products });
  }

  async reserve(items: OrderItem[], direction: "decrease" | "restore") {
    return withDataStoreLock("website-inventory", () => this.reserveUnlocked(items, direction));
  }

  async reserveOrder(order: ShopOrder) {
    return withDataStoreLock("website-inventory", async () => {
      const current = await findOrderByCode(order.code) || order;
      if (current.inventoryReservationApplied && !current.inventoryReservationReleased) return current;
      await this.reserveUnlocked(current.items, "decrease");
      try {
        return await updateOrder(current.code, {
          inventoryReservationApplied: true,
          inventoryReservationReleased: false
        }) || { ...current, inventoryReservationApplied: true, inventoryReservationReleased: false };
      } catch (error) {
        await this.reserveUnlocked(current.items, "restore");
        throw error;
      }
    });
  }

  async confirmReservedPayment(orderCode: string, payment: Partial<ShopOrder>) {
    return withDataStoreLock("website-inventory", async () => {
      const current = await findOrderByCode(orderCode);
      if (!current) throw new Error("Không tìm thấy đơn hàng để xác nhận thanh toán.");
      if (current.status === "cancelled") throw new Error("Đơn hàng đã hủy nên không thể xác nhận thanh toán.");
      if (current.status === "paid") return current;
      if (!current.inventoryReservationApplied || current.inventoryReservationReleased) {
        throw new PancakeIntegrationError("Đơn ZaloPay không còn lượt giữ tồn kho hợp lệ.", "RESERVATION_EXPIRED", 409);
      }
      return await updateOrder(current.code, {
        ...payment,
        status: "paid"
      }) || { ...current, ...payment, status: "paid" as const };
    });
  }

  async renewZaloPayReservation(orderCode: string, patch: Partial<ShopOrder>) {
    return withDataStoreLock("website-inventory", async () => {
      const current = await findOrderByCode(orderCode);
      const expiresAt = new Date(current?.inventoryReservationExpiresAt || "").getTime();
      const active = current?.paymentMethod === "zalopay"
        && current.status === "pending"
        && current.inventoryReservationApplied
        && !current.inventoryReservationReleased
        && Number.isFinite(expiresAt)
        && expiresAt > Date.now();
      if (!current || !active) {
        throw new PancakeIntegrationError("Lượt giữ hàng ZaloPay đã hết 5 phút. Vui lòng đặt lại.", "RESERVATION_EXPIRED", 409);
      }
      return await updateOrder(current.code, patch) || { ...current, ...patch };
    });
  }

  async expireZaloPayReservation(orderCode: string, now = new Date()) {
    return withDataStoreLock("website-inventory", async () => {
      const current = await findOrderByCode(orderCode);
      if (!current) return null;
      const expiresAt = new Date(current.inventoryReservationExpiresAt || "").getTime();
      const canExpire = current.paymentMethod === "zalopay"
        && current.status === "pending"
        && current.inventoryReservationApplied
        && !current.inventoryReservationReleased
        && Number.isFinite(expiresAt)
        && expiresAt <= now.getTime();
      if (!canExpire) return current;

      await this.reserveUnlocked(current.items, "restore");
      try {
        return await updateOrder(current.code, {
          status: "cancelled",
          shippingStatus: "cancelled",
          inventoryReservationReleased: true,
          paymentExpiredAt: current.inventoryReservationExpiresAt,
          cancellationReason: "Hết hạn thanh toán",
          providerMessage: "Giao dịch ZaloPay hết hạn sau 5 phút",
          refundStatus: "not_required",
          refundMessage: ""
        }) || { ...current, status: "cancelled" as const, inventoryReservationReleased: true };
      } catch (error) {
        await this.reserveUnlocked(current.items, "decrease");
        throw error;
      }
    });
  }

  async createReservedOrder(order: ShopOrder) {
    return withDataStoreLock("website-inventory", async () => {
      if (order.checkoutRequestId) {
        const existing = await findOrderByCheckoutRequestId(order.checkoutRequestId, order.customerDeviceId);
        if (existing) {
          if (existing.inventoryReservationApplied && !existing.inventoryReservationReleased) return existing;
          await this.reserveUnlocked(existing.items, "decrease");
          try {
            return await updateOrder(existing.code, {
              inventoryReservationApplied: true,
              inventoryReservationReleased: false
            }) || existing;
          } catch (error) {
            await this.reserveUnlocked(existing.items, "restore");
            throw error;
          }
        }
      }

      await this.reserveUnlocked(order.items, "decrease");
      try {
        return await createOrder({
          ...order,
          inventoryReservationApplied: true,
          inventoryReservationReleased: false
        });
      } catch (error) {
        await this.reserveUnlocked(order.items, "restore");
        throw error;
      }
    });
  }

  async releaseOrder(order: ShopOrder) {
    return withDataStoreLock("website-inventory", async () => {
      const current = await findOrderByCode(order.code) || order;
      if (!current.inventoryReservationApplied || current.inventoryReservationReleased) return current;
      await this.reserveUnlocked(current.items, "restore");
      try {
        return await updateOrder(current.code, { inventoryReservationReleased: true })
          || { ...current, inventoryReservationReleased: true };
      } catch (error) {
        await this.reserveUnlocked(current.items, "decrease");
        throw error;
      }
    });
  }
}
