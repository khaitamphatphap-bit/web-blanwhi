import { findOrderByCode, readOrders, updateOrder } from "@/lib/orders";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import type { ShopOrder } from "@/lib/types";
import { mapPancakeStatus } from "@/lib/pancake/domain";
import { shortOrderCode } from "@/lib/order-code";

function externalId(payload: Record<string, unknown>) {
  const record = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const order = (record.order && typeof record.order === "object" ? record.order : record) as Record<string, unknown>;
  return String(order.id || order._id || order.order_id || order.display_id || "");
}

function pancakeOrderId(order: ShopOrder) {
  return order.pancakeOrderId || (order.pancakeStatus ? order.providerOrderId || "" : "");
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
  const trackingCode = deepValue(payload, [
    "tracking_number",
    "tracking_no",
    "tracking_code",
    "waybill_no",
    "waybill_code",
    "shipment_code",
    "shipping_code",
    "bill_code",
    "label_id",
    "extend_code",
    "tracking_id",
    "ORDER_NUMBER",
    "order_number",
    "order_number_vtp"
  ]);
  const carrier = deepValue(payload, ["partner_name", "shipping_partner", "carrier", "carrier_name"]);
  const carrierLabel = /spx|shopee\s*x?press|vtp|viettel/i.test(carrier)
    ? "SPX Express"
    : (carrier || "SPX Express");
  return {
    ...(trackingCode ? { trackingCode } : {}),
    shippingCarrier: carrierLabel,
    ...(includeReadyStatus ? { shippingStatus: "ready_to_ship" as const } : {}),
    shippingMessage: trackingCode
      ? `Đã tạo vận đơn ${carrierLabel}, sẵn sàng in và bàn giao.`
      : `Đã chuyển sang ${carrierLabel}, đang nhận mã vận đơn.`
  };
}

function hasShippingDetails(payload: unknown) {
  return Boolean(deepValue(payload, [
    "partner_name",
    "shipping_partner",
    "carrier",
    "carrier_name",
    "tracking_number",
    "tracking_no",
    "tracking_code",
    "waybill_no",
    "waybill_code",
    "shipment_code",
    "shipping_code",
    "bill_code",
    "label_id",
    "extend_code",
    "tracking_id",
    "order_number",
    "order_number_vtp"
  ]));
}

export class OrderSyncService {
  constructor(private readonly pancake = new PancakeService()) {}

  async reconcileExisting(order: ShopOrder) {
    const existing = await this.pancake.findOrder(order.code, order.customer.phone);
    if (!existing) return order;
    const existingId = externalId(existing);
    const existingCarrier = deepValue(existing, ["partner_name", "shipping_partner", "carrier", "carrier_name"]);
    let spxAssigned = /spx|shopee\s*x?press/i.test(existingCarrier);
    const mayChangeCarrier = !["shipping", "delivered", "delivery_failed", "returning", "returned", "cancelled"].includes(order.shippingStatus || "");
    if (order.deliveryType !== "express" && existingId && mayChangeCarrier && !spxAssigned) {
      try {
        await this.pancake.assignSpxPartner(existingId);
        spxAssigned = true;
        await PancakeLogger.write("info", "order.shipping", "Đã chuyển đơn Pancake sang SPX Express.", order.code);
      } catch (error) {
        await PancakeLogger.write("error", "order.shipping", `Chưa chuyển được đơn Pancake sang SPX Express: ${ExceptionHandler.message(error)}`, order.code);
        throw error;
      }
    }
    const targetPosOrderCode = shortOrderCode(order.code);
    const remoteOrderCode = value(existing, ["custom_id", "partner_order_id", "order_code", "code"])
      .replace(/^BLANWHI:/i, "")
      .trim()
      .toUpperCase();
    let posOrderCodeUpdated = remoteOrderCode === targetPosOrderCode;
    if (existingId && !posOrderCodeUpdated) {
      try {
        await this.pancake.updateOrderCode(existingId, targetPosOrderCode);
        posOrderCodeUpdated = true;
        await PancakeLogger.write("info", "order.code", `Đã đổi mã đơn Pancake thành ${targetPosOrderCode}.`, order.code);
      } catch (error) {
        await PancakeLogger.write("error", "order.code", `Chưa đổi được mã đơn Pancake: ${ExceptionHandler.message(error)}`, order.code);
      }
    }
    const remoteStatus = value(existing, ["status", "order_status", "state"]);
    const mapped = mapPancakeStatus(remoteStatus);
    if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
      await new InventoryService().reserve(order.items, "restore");
    }
    const updated = await updateOrder(order.code, {
      pancakeOrderId: existingId || pancakeOrderId(order),
      ...(posOrderCodeUpdated ? { posOrderCode: targetPosOrderCode } : {}),
      ...(mapped.status === "cancelled" && order.status !== "cancelled" ? { status: "cancelled" as const } : {}),
      ...(mapped.shippingStatus && order.deliveryType !== "express" ? { shippingStatus: mapped.shippingStatus } : {}),
      ...(mapped.pancakeStatus ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(order.deliveryType !== "express" && hasShippingDetails(existing)
        ? shippingUpdate(existing, !mapped.shippingStatus || ["unknown", "not_created"].includes(mapped.shippingStatus))
        : order.deliveryType !== "express" && spxAssigned
          ? { shippingCarrier: "SPX Express", shippingMessage: "Đã chuyển sang SPX Express, đang nhận mã vận đơn." }
          : {}),
      inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
      externalSync: { ...order.externalSync, pancake: `Đã tồn tại trên Pancake${existingId ? ` #${existingId}` : ""}`, lastSyncedAt: new Date().toISOString() }
    });
    await PancakeLogger.write("info", "order.idempotency", "Đã nhận lại ID của đơn có sẵn trên Pancake.", order.code);
    return updated || order;
  }

  async create(order: ShopOrder, enqueueOnFailure = true) {
    const latest = await findOrderByCode(order.code);
    if (latest?.status === "cancelled") return latest;
    const current = latest || order;
    if (current.status !== "paid" && !(String(current.paymentMethod || "").trim().toLowerCase() === "cod" && current.status === "pending")) {
      return await updateOrder(order.code, {
        externalSync: {
          ...(latest || order).externalSync,
          pancake: "Chờ thanh toán - chưa gửi Pancake",
          lastSyncedAt: new Date().toISOString()
        }
      }) || latest || order;
    }
    if (pancakeOrderId(current) || current.externalSync?.pancake?.startsWith("Đã tạo")) return current;
    try {
      const existing = await this.pancake.findOrder(current.code, current.customer.phone);
      if (existing) {
        const existingStatus = mapPancakeStatus(value(existing, ["status", "order_status", "state"]));
        if (existingStatus.pancakeStatus !== "cancelled") return this.reconcileExisting(current);
      }
      const response = await this.pancake.createOrder(current);
      const createdPancakeOrderId = externalId(response);
      const updated = await updateOrder(order.code, {
        pancakeOrderId: createdPancakeOrderId || pancakeOrderId(current),
        posOrderCode: shortOrderCode(current.code),
        pancakeStatus: "packing",
        ...(current.deliveryType === "express" ? { shippingStatus: "awaiting_creation" as const, shippingCarrier: "", trackingCode: "", shippingMessage: "Chờ tạo vận đơn hỏa tốc" } : shippingUpdate(response)),
        externalSync: {
          ...current.externalSync,
          pancake: `Đã tạo${createdPancakeOrderId ? ` #${createdPancakeOrderId}` : ""}`,
          lastSyncedAt: new Date().toISOString()
        }
      });
      await PancakeLogger.write("info", "order.create", "Đã tạo đơn trên Pancake.", order.code);
      return updated || current;
    } catch (error) {
      const message = ExceptionHandler.message(error);
      if (/trùng|duplicate/i.test(message)) {
        try {
          const reconciled = await this.reconcileExisting(current);
          if (pancakeOrderId(reconciled)) return reconciled;
        } catch {
          // Tiếp tục ghi nhận lỗi gốc và đưa vào hàng đợi.
        }
      }
      await PancakeLogger.write("error", "order.create", message, order.code);
      await updateOrder(current.code, { externalSync: { ...current.externalSync, pancake: `Chờ gửi lại: ${message}`, lastSyncedAt: new Date().toISOString() } });
      if (enqueueOnFailure) {
        try { await QueueHandler.enqueue("order.create", { orderCode: order.code }); } catch { /* Lỗi hàng đợi không che mất lỗi Pancake gốc. */ }
      }
      throw error;
    }
  }

  async removeUnpaidFromPos(order: ShopOrder) {
    const paymentMethod = String(order.paymentMethod || "").trim().toLowerCase();
    if (order.status === "paid" || paymentMethod === "cod") return order;
    const remoteOrderId = String(order.pancakeOrderId || (order.pancakeStatus ? order.providerOrderId : "") || "").trim();
    if (!remoteOrderId) return order;

    try {
      await this.pancake.cancelOrder(remoteOrderId);
      const updated = await updateOrder(order.code, {
        pancakeOrderId: undefined,
        pancakeStatus: undefined,
        posOrderCode: undefined,
        trackingCode: "",
        shippingStatus: "not_created",
        shippingMessage: "Chưa thanh toán - chưa gửi POS/SPX.",
        externalSync: {
          ...order.externalSync,
          pancake: "Đã gỡ đơn chưa thanh toán khỏi Pancake POS",
          lastSyncedAt: new Date().toISOString()
        }
      });
      await PancakeLogger.write("info", "order.unpaid_cleanup", "Đã hủy đơn chưa thanh toán trên Pancake POS.", order.code);
      return updated || order;
    } catch (error) {
      const message = ExceptionHandler.message(error);
      await PancakeLogger.write("error", "order.unpaid_cleanup", message, order.code);
      throw error;
    }
  }
  async cancel(order: ShopOrder, enqueueOnFailure = true) {
    const remoteOrderId = pancakeOrderId(order);
    if (!remoteOrderId) return order;
    try {
      await this.pancake.cancelOrder(remoteOrderId);
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
    const updated = await updateOrder(order.code, {
      ...(mapped.status === "cancelled" && order.status !== "cancelled" ? { status: "cancelled" as const } : {}),
      ...(mapped.shippingStatus && !preserveCancellation && order.deliveryType !== "express" ? { shippingStatus: mapped.shippingStatus } : {}),
      ...(mapped.pancakeStatus && !preserveCancellation ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(order.deliveryType !== "express" && hasShippingDetails(payload) && !preserveCancellation
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
    const localOrders = await readOrders();
    const localByCode = new Map<string, ShopOrder>();
    for (const order of localOrders) {
      localByCode.set(order.code.trim().toUpperCase(), order);
      localByCode.set(shortOrderCode(order.code), order);
      if (order.posOrderCode) localByCode.set(order.posOrderCode.trim().toUpperCase(), order);
    }
    let updated = 0;
    for (const payload of remote) {
      const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "").trim().toUpperCase();
      const order = localByCode.get(code);
      if (!code || !order) continue;
      const mapped = mapPancakeStatus(value(payload, ["status", "order_status", "state"]));
      const remoteShipping = hasShippingDetails(payload) ? shippingUpdate(payload, false) : {};
      const changed = Boolean(
        (mapped.status === "cancelled" && order.status !== "cancelled")
        || (mapped.pancakeStatus && mapped.pancakeStatus !== order.pancakeStatus)
        || (mapped.shippingStatus && mapped.shippingStatus !== "unknown" && mapped.shippingStatus !== order.shippingStatus)
        || ("trackingCode" in remoteShipping && remoteShipping.trackingCode && remoteShipping.trackingCode !== order.trackingCode)
        || ("shippingCarrier" in remoteShipping && remoteShipping.shippingCarrier && remoteShipping.shippingCarrier !== order.shippingCarrier)
      );
      if (!changed) continue;
      await this.applyRemoteUpdate(payload);
      updated += 1;
    }
    return { received: remote.length, updated };
  }
}
