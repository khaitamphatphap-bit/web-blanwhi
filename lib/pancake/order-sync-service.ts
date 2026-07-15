import { findOrderByCode, updateOrder } from "@/lib/orders";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import type { ShopOrder } from "@/lib/types";
import { mapPancakeStatus } from "@/lib/pancake/domain";

function externalId(payload: Record<string, unknown>) {
  const record = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const order = (record.order && typeof record.order === "object" ? record.order : record) as Record<string, unknown>;
  return String(order.id || order._id || order.order_id || order.display_id || "");
}

function remoteRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["orders", "data", "items"]) {
    const nested = remoteRecords(record[key]);
    if (nested.length) return nested;
  }
  return [];
}

function value(payload: Record<string, unknown>, keys: string[]) {
  const nested = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const order = (nested.order && typeof nested.order === "object" ? nested.order : nested) as Record<string, unknown>;
  for (const key of keys) if (order[key] !== undefined && order[key] !== null) return String(order[key]);
  return "";
}

function deepValue(payload: unknown, keys: string[], depth = 0): string {
  if (!payload || typeof payload !== "object" || depth > 5) return "";
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) return String(candidate).trim();
  }
  for (const candidate of Object.values(record)) {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const found = deepValue(item, keys, depth + 1);
        if (found) return found;
      }
    } else {
      const found = deepValue(candidate, keys, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function shippingUpdate(payload: unknown, includeReadyStatus = true) {
  const trackingCode = deepValue(payload, ["order_number_vtp", "extend_code", "tracking_id", "tracking_code", "ORDER_NUMBER", "order_number"]);
  const carrier = deepValue(payload, ["partner_name"]);
  return {
    ...(trackingCode ? { trackingCode } : {}),
    shippingCarrier: /vtp|viettel/i.test(carrier) ? "Viettel Post" : (carrier || "Viettel Post"),
    ...(includeReadyStatus ? { shippingStatus: "ready_to_ship" as const } : {}),
    shippingMessage: trackingCode ? "Đã tạo vận đơn Viettel Post, sẵn sàng in và bàn giao." : "Đã chuyển sang Viettel Post, đang nhận mã vận đơn."
  };
}

function hasViettelPostShipping(payload: unknown) {
  return /vtp|viettel/i.test(deepValue(payload, ["partner_name", "shipping_partner", "carrier"]))
    || Boolean(deepValue(payload, ["order_number_vtp", "extend_code"]));
}

export class OrderSyncService {
  constructor(private readonly pancake = new PancakeService()) {}

  async reconcileExisting(order: ShopOrder) {
    const existing = await this.pancake.findOrder(order.code, order.customer.phone);
    if (!existing) return order;
    const existingId = externalId(existing);
    const remoteStatus = value(existing, ["status", "order_status", "state"]);
    const mapped = mapPancakeStatus(remoteStatus);
    if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
      await new InventoryService().reserve(order.items, "restore");
    }
    const updated = await updateOrder(order.code, {
      providerOrderId: existingId || order.providerOrderId,
      ...(mapped.status && order.status !== "cancelled" ? { status: mapped.status } : {}),
      ...(mapped.shippingStatus ? { shippingStatus: mapped.shippingStatus } : {}),
      ...(mapped.pancakeStatus ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(hasViettelPostShipping(existing) ? shippingUpdate(existing, false) : {}),
      inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
      externalSync: { ...order.externalSync, pancake: `Đã tồn tại trên Pancake${existingId ? ` #${existingId}` : ""}`, lastSyncedAt: new Date().toISOString() }
    });
    await PancakeLogger.write("info", "order.idempotency", "Đã nhận lại ID của đơn có sẵn trên Pancake.", order.code);
    return updated || order;
  }

  async create(order: ShopOrder, enqueueOnFailure = true) {
    const latest = await findOrderByCode(order.code);
    if (latest?.status === "cancelled") return latest;
    if (order.providerOrderId || order.externalSync?.pancake?.startsWith("Đã tạo")) return order;
    try {
      const existing = enqueueOnFailure ? null : await this.pancake.findOrder(order.code, order.customer.phone);
      if (existing) {
        return this.reconcileExisting(order);
      }
      const response = await this.pancake.createOrder(order);
      const providerOrderId = externalId(response);
      const updated = await updateOrder(order.code, {
        providerOrderId: providerOrderId || order.providerOrderId,
        pancakeStatus: "packing",
        ...shippingUpdate(response),
        externalSync: {
          ...order.externalSync,
          pancake: `Đã tạo${providerOrderId ? ` #${providerOrderId}` : ""}`,
          lastSyncedAt: new Date().toISOString()
        }
      });
      await PancakeLogger.write("info", "order.create", "Đã tạo đơn trên Pancake.", order.code);
      return updated || order;
    } catch (error) {
      const message = ExceptionHandler.message(error);
      if (/trùng|duplicate/i.test(message)) {
        try {
          const reconciled = await this.reconcileExisting(order);
          if (reconciled.providerOrderId) return reconciled;
        } catch {
          // Tiếp tục ghi nhận lỗi gốc và đưa vào hàng đợi.
        }
      }
      await PancakeLogger.write("error", "order.create", message, order.code);
      await updateOrder(order.code, { externalSync: { ...order.externalSync, pancake: `Chờ gửi lại: ${message}`, lastSyncedAt: new Date().toISOString() } });
      if (enqueueOnFailure) {
        try { await QueueHandler.enqueue("order.create", { orderCode: order.code }); } catch { /* Lỗi hàng đợi không che mất lỗi Pancake gốc. */ }
      }
      throw error;
    }
  }

  async cancel(order: ShopOrder, enqueueOnFailure = true) {
    if (!order.providerOrderId) return order;
    try {
      await this.pancake.cancelOrder(order.providerOrderId);
      const updated = await updateOrder(order.code, {
        pancakeStatus: "cancelled",
        externalSync: { ...order.externalSync, pancake: "Đã hủy trên Pancake", lastSyncedAt: new Date().toISOString() }
      });
      await PancakeLogger.write("info", "order.cancel", "Đã hủy đơn trên Pancake.", order.code);
      return updated || order;
    } catch (error) {
      const message = ExceptionHandler.message(error);
      await PancakeLogger.write("error", "order.cancel", message, order.code);
      await updateOrder(order.code, { externalSync: { ...order.externalSync, pancake: `Chờ gửi yêu cầu hủy: ${message}`, lastSyncedAt: new Date().toISOString() } });
      if (enqueueOnFailure) {
        try { await QueueHandler.enqueue("order.cancel", { orderCode: order.code }); } catch { /* Lỗi hàng đợi không che mất lỗi Pancake gốc. */ }
      }
      throw error;
    }
  }

  async retry(orderCode: string) {
    const order = await findOrderByCode(orderCode);
    if (!order) throw new Error(`Không tìm thấy đơn ${orderCode}.`);
    return this.create(order, false);
  }

  async applyRemoteUpdate(payload: Record<string, unknown>) {
    const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "");
    if (!code) throw new PancakeIntegrationError("Dữ liệu Pancake thiếu mã đơn website.", "REMOTE_ORDER_CODE_MISSING", 400);
    const order = await findOrderByCode(code);
    if (!order) throw new PancakeIntegrationError(`Không tìm thấy đơn ${code}.`, "ORDER_NOT_FOUND", 404);
    const pancakeStatus = value(payload, ["status", "order_status", "state"]);
    const mapped = mapPancakeStatus(pancakeStatus);
    const preserveCancellation = order.status === "cancelled" && mapped.pancakeStatus !== "cancelled";
    if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
      await new InventoryService().reserve(order.items, "restore");
    }
    const updated = await updateOrder(code, {
      ...(mapped.status && order.status !== "cancelled" ? { status: mapped.status } : {}),
      ...(mapped.shippingStatus && !preserveCancellation ? { shippingStatus: mapped.shippingStatus } : {}),
      ...(mapped.pancakeStatus && !preserveCancellation ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(hasViettelPostShipping(payload) && !preserveCancellation
        ? shippingUpdate(payload, false)
        : {}),
      inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
      externalSync: { ...order.externalSync, pancake: `Pancake: ${pancakeStatus || "đã cập nhật"}`, lastSyncedAt: new Date().toISOString() }
    });
    await PancakeLogger.write("info", "order.status", `Đã nhận trạng thái ${pancakeStatus || "không rõ"}.`, code);
    return updated;
  }

  async pollStatuses() {
    const remote = remoteRecords(await this.pancake.orders());
    let updated = 0;
    for (const payload of remote) {
      const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "");
      if (!code || !await findOrderByCode(code)) continue;
      await this.applyRemoteUpdate(payload);
      updated += 1;
    }
    return { received: remote.length, updated };
  }
}
