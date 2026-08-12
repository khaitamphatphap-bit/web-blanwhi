import { findOrderByCode, readOrders, updateOrder, writeOrders } from "@/lib/orders";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";
import type { ShippingStatus, ShopOrder } from "@/lib/types";
import { mapPancakeStatus } from "@/lib/pancake/domain";
import { shortOrderCode } from "@/lib/order-code";

function validPancakeOrderId(value: unknown) {
  const candidate = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!candidate || /^(BLW-|BLANWHI:|\[object Object\]$)/i.test(candidate)) return "";
  return candidate;
}

function externalId(payload: Record<string, unknown>) {
  const record = (payload.data && typeof payload.data === "object" ? payload.data : payload) as Record<string, unknown>;
  const order = (record.order && typeof record.order === "object" ? record.order : record) as Record<string, unknown>;
  return validPancakeOrderId(order.id || order._id || order.order_id || order.display_id);
}

function pancakeOrderId(order: ShopOrder) {
  return validPancakeOrderId(order.pancakeOrderId || "");
}

const shippingProgress: Partial<Record<ShippingStatus, number>> = {
  unknown: 0,
  not_created: 0,
  awaiting_creation: 1,
  finding_driver: 1,
  ready_to_ship: 2,
  driver_assigned: 2,
  shipping: 3,
  delivery_failed: 3,
  returning: 3,
  delivered: 4,
  returned: 4,
  cancelled: 4
};

function latestShippingStatus(current: ShippingStatus | undefined, incoming: ShippingStatus | undefined) {
  if (!incoming || incoming === "unknown") return current;
  if (!current || current === "unknown") return incoming;
  if (["cancelled", "returning", "returned", "delivery_failed"].includes(incoming)) return incoming;
  if (["delivered", "returned", "cancelled"].includes(current)) return current;
  return (shippingProgress[incoming] || 0) >= (shippingProgress[current] || 0) ? incoming : current;
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
    if ((typeof candidate === "string" || typeof candidate === "number") && String(candidate).trim()) return String(candidate).trim();
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const nestedKey of ["value", "code", "tracking_code", "trackingCode", "extend_code", "tracking_number", "tracking_no"]) {
        const nestedCandidate = nested[nestedKey];
        if ((typeof nestedCandidate === "string" || typeof nestedCandidate === "number") && String(nestedCandidate).trim()) {
          return String(nestedCandidate).trim();
        }
      }
    }
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

function findSpxTrackingCode(payload: unknown, depth = 0): string {
  if (payload === null || payload === undefined || depth > 7) return "";
  if (typeof payload === "string" || typeof payload === "number") {
    return String(payload).match(/\bSPXVN\d{10,}\b/i)?.[0]?.toUpperCase() || "";
  }
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = findSpxTrackingCode(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof payload === "object") {
    for (const item of Object.values(payload as Record<string, unknown>)) {
      const found = findSpxTrackingCode(item, depth + 1);
      if (found) return found;
    }
  }
  return "";
}

function logisticsShippingStatus(payload: unknown) {
  const raw = deepValue(payload, [
    "shipping_status",
    "delivery_status",
    "shipment_status",
    "logistics_status",
    "partner_status",
    "shipping_state",
    "delivery_state"
  ]).toLowerCase().replace(/\s+/g, "_");
  if (!raw) return undefined;
  if (/delivered|delivery_success|giao_thành_công|giao_hàng_thành_công|đã_giao/.test(raw)) return "delivered" as const;
  if (/returning|return_in_progress|đang_hoàn/.test(raw)) return "returning" as const;
  if (/returned|return_completed|hoàn_hàng/.test(raw)) return "returned" as const;
  if (/cancelled|canceled|đã_hủy|hủy_đơn/.test(raw)) return "cancelled" as const;
  if (/delivery_failed|failed_delivery|giao_thất_bại|giao_không_thành_công/.test(raw)) return "delivery_failed" as const;
  if (/shipping|delivering|in_transit|picked_up|handed_over|đang_giao|đã_lấy_hàng|đã_bàn_giao/.test(raw)) return "shipping" as const;
  if (/driver_assigned|courier_assigned|shipper_assigned|đã_có_tài_xế/.test(raw)) return "driver_assigned" as const;
  if (/finding_driver|searching_driver|đang_tìm_tài_xế/.test(raw)) return "finding_driver" as const;
  if (/ready_to_ship|ready_for_pickup|awaiting_pickup|chờ_lấy_hàng|chờ_bàn_giao/.test(raw)) return "ready_to_ship" as const;
  return undefined;
}

function shippingUpdate(payload: unknown, includeReadyStatus = true) {
  let trackingCode = findSpxTrackingCode(payload) || deepValue(payload, [
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
    "order_number_vtp",
    "partner_order_number",
    "shipping_order_code",
    "logistics_code",
    "waybill"
  ]);
  if (/^(\[object Object\]|BLW-|BLANWHI:)/i.test(trackingCode) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(trackingCode)) trackingCode = "";
  const payloadRecord = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const trackingUrl = deepValue(payload, ["tracking_url", "trackingUrl", "tracking_link", "trackingLink"])
    || deepValue(payloadRecord.tracking_lookup, ["url"]);
  const carrier = deepValue(payload, ["partner_name", "shipping_partner", "carrier", "carrier_name"]);
  if (!trackingCode) {
    const partnerTrackingCode = deepValue(payload, ["partner_order_code", "shipping_order_id", "logistics_order_id", "partner_order_id"]);
    const normalizedPartnerCode = partnerTrackingCode.trim();
    const looksLikeWebsiteCode = /^(BLW-|BLANWHI:)/i.test(normalizedPartnerCode);
    const looksLikeInternalUuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(normalizedPartnerCode);
    if (normalizedPartnerCode && !looksLikeWebsiteCode && !looksLikeInternalUuid) trackingCode = normalizedPartnerCode;
  }
  const carrierLabel = /vtp|viettel/i.test(carrier)
    ? "ViettelPost"
    : /spx|shopee\s*x?press/i.test(carrier)
    ? "SPX Express"
    : (carrier || "SPX Express");
  const liveStatus = logisticsShippingStatus(payload);
  const liveMessage: Partial<Record<ShippingStatus, string>> = {
    finding_driver: "Đang tìm tài xế nhận đơn.",
    driver_assigned: "Đơn vị vận chuyển đã phân công tài xế.",
    ready_to_ship: `Đã tạo vận đơn ${carrierLabel}, chờ đơn vị vận chuyển nhận hàng.`,
    shipping: `${carrierLabel} đã nhận hàng và đang vận chuyển.`,
    delivered: "Đơn hàng đã được giao thành công.",
    delivery_failed: "Lần giao hàng gần nhất chưa thành công.",
    returning: "Đơn hàng đang được hoàn về shop.",
    returned: "Đơn hàng đã được hoàn về shop.",
    cancelled: "Vận đơn đã được hủy."
  };
  return {
    ...(trackingCode ? { trackingCode } : {}),
    ...(trackingUrl ? { deliveryTrackingUrl: trackingUrl } : {}),
    shippingCarrier: carrierLabel,
    ...(includeReadyStatus ? { shippingStatus: "ready_to_ship" as const } : {}),
    shippingMessage: (liveStatus && liveMessage[liveStatus]) || (trackingCode
      ? `Đã tạo vận đơn ${carrierLabel}, chờ đơn vị vận chuyển nhận hàng.`
      : `Đã chuyển sang ${carrierLabel}, đang nhận mã vận đơn.`)
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
    "partner_order_code",
    "shipping_order_id",
    "logistics_order_id",
    "partner_order_id",
    "order_number",
    "order_number_vtp",
    "partner_order_number",
    "shipping_order_code",
    "logistics_code",
    "waybill",
    "tracking_url",
    "trackingUrl",
    "tracking_link",
    "trackingLink"
  ]));
}

function hasTrackingCode(payload: unknown) {
  return Boolean(deepValue(payload, [
    "tracking_number", "tracking_no", "tracking_code", "waybill_no", "waybill_code",
    "shipment_code", "shipping_code", "bill_code", "label_id", "extend_code",
    "tracking_id", "ORDER_NUMBER", "order_number", "order_number_vtp",
    "partner_order_number", "shipping_order_code", "logistics_code", "waybill"
  ]));
}

export class OrderSyncService {
  constructor(private readonly pancake = new PancakeService()) {}

  private async refreshItemLinks(order: ShopOrder) {
    if (order.items.every((item) => item.pancakeVariationId || item.pancakeProductId || item.pancakeSku)) return order;
    const availability = await new InventoryService().availability();
    let changed = false;
    const items = order.items.map((item) => {
      if (item.pancakeVariationId || item.pancakeProductId || item.pancakeSku) return item;
      const linked = availability.find((candidate) => candidate.linked && (
        (item.productId === candidate.productId && item.inventoryKey === candidate.key)
        || (item.inventoryKey === candidate.key && item.sku === candidate.sku)
      ));
      if (!linked) return item;
      changed = true;
      return {
        ...item,
        pancakeProductId: linked.pancakeProductId || undefined,
        pancakeVariationId: linked.pancakeVariationId || undefined,
        pancakeSku: linked.pancakeSku || undefined
      };
    });
    if (!changed) return order;
    return await updateOrder(order.code, { items }) || { ...order, items };
  }

  async reconcileExisting(order: ShopOrder) {
    const knownId = pancakeOrderId(order);
    let existing: Record<string, unknown> | null = null;
    if (knownId) {
      try {
        existing = await this.pancake.order(knownId);
      } catch (error) {
        await PancakeLogger.write("error", "order.detail", `Chưa đọc được chi tiết đơn Pancake bằng ID: ${ExceptionHandler.message(error)}`, order.code);
      }
    }
    if (!existing) existing = await this.pancake.findOrder(order.code, order.customer.phone);
    if (!existing) return order;
    const existingId = externalId(existing) || knownId;
    let remotePayload = existing;
    if (existingId && !knownId) {
      try {
        remotePayload = await this.pancake.order(existingId);
      } catch (error) {
        await PancakeLogger.write("error", "order.detail", `Chưa đọc được chi tiết đơn Pancake: ${ExceptionHandler.message(error)}`, order.code);
      }
    }
    const systemId = deepValue(remotePayload, ["system_id"]);
    if (systemId && !hasTrackingCode(remotePayload)) {
      try {
        const trackingPayload = await this.pancake.tracking(systemId);
        remotePayload = { order_details: remotePayload, tracking_lookup: trackingPayload };
      } catch (error) {
        await PancakeLogger.write("error", "order.tracking", `Chưa đọc được mã vận đơn Pancake/SPX: ${ExceptionHandler.message(error)}`, order.code);
      }
    }
    const existingCarrier = deepValue(remotePayload, ["partner_name", "shipping_partner", "carrier", "carrier_name"]);
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
    const remoteStatus = value(remotePayload, ["status", "order_status", "state"]) || value(existing, ["status", "order_status", "state"]);
    const mapped = mapPancakeStatus(remoteStatus);
    const logisticsStatus = logisticsShippingStatus(remotePayload);
    const synchronizedShippingStatus = latestShippingStatus(order.shippingStatus, logisticsStatus || mapped.shippingStatus);
    if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
      await new InventoryService().reserve(order.items, "restore");
    }
    const updated = await updateOrder(order.code, {
      pancakeOrderId: existingId || pancakeOrderId(order),
      ...(posOrderCodeUpdated ? { posOrderCode: targetPosOrderCode } : {}),
      ...(mapped.status === "cancelled" && order.status !== "cancelled" ? { status: "cancelled" as const } : {}),
      ...(mapped.pancakeStatus ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(order.deliveryType !== "express" && hasShippingDetails(remotePayload)
        ? shippingUpdate(remotePayload, !logisticsStatus && (!mapped.shippingStatus || ["unknown", "not_created"].includes(mapped.shippingStatus)))
        : order.deliveryType !== "express" && spxAssigned
          ? { shippingCarrier: "SPX Express", shippingMessage: "Đã chuyển sang SPX Express, đang nhận mã vận đơn." }
          : {}),
      ...(synchronizedShippingStatus && order.deliveryType !== "express" ? { shippingStatus: synchronizedShippingStatus } : {}),
      inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
      externalSync: { ...order.externalSync, pancake: `Đã tồn tại trên Pancake${existingId ? ` #${existingId}` : ""}`, lastSyncedAt: new Date().toISOString() }
    });
    await PancakeLogger.write("info", "order.idempotency", "Đã nhận lại ID của đơn có sẵn trên Pancake.", order.code);
    return updated || order;
  }

  async create(order: ShopOrder, enqueueOnFailure = true) {
    const latest = await findOrderByCode(order.code);
    if (latest?.status === "cancelled") return latest;
    const current = await this.refreshItemLinks(latest || order);
    if (current.status !== "paid" && !(String(current.paymentMethod || "").trim().toLowerCase() === "cod" && current.status === "pending")) {
      return await updateOrder(order.code, {
        externalSync: {
          ...(latest || order).externalSync,
          pancake: "Chờ thanh toán - chưa gửi Pancake",
          lastSyncedAt: new Date().toISOString()
        }
      }) || latest || order;
    }
    if (pancakeOrderId(current)) return current;
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
    const remoteOrderId = pancakeOrderId(order);
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
    const candidateIds: string[] = [];
    const knownId = pancakeOrderId(order);
    if (knownId) candidateIds.push(knownId);
    try {
      const discovered = await this.pancake.findOrder(order.code, order.customer.phone);
      const discoveredId = discovered ? externalId(discovered) : "";
      if (discoveredId && !candidateIds.includes(discoveredId)) candidateIds.push(discoveredId);
    } catch {
      // Vẫn thử ID đã lưu nếu bước tìm lại đơn tạm thời không phản hồi.
    }
    if (!candidateIds.length) return order;
    let lastError: unknown;
    try {
      for (const remoteOrderId of candidateIds) {
        try {
          await this.pancake.cancelOrder(remoteOrderId);
          const updated = await updateOrder(order.code, {
            pancakeOrderId: remoteOrderId,
            pancakeStatus: "cancelled",
            externalSync: { ...order.externalSync, pancake: "Đã hủy trên Pancake", lastSyncedAt: new Date().toISOString() }
          });
          await PancakeLogger.write("info", "order.cancel", `Đã hủy đơn trên Pancake #${remoteOrderId}.`, order.code);
          return updated || order;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error("Pancake không xác nhận hủy đơn.");
    } catch (error) {
      const normalized = ExceptionHandler.normalize(error);
      const message = normalized.message;
      await PancakeLogger.write("error", "order.cancel", message, order.code);
      await updateOrder(order.code, { externalSync: { ...order.externalSync, pancake: `Chờ gửi yêu cầu hủy: ${message}`, lastSyncedAt: new Date().toISOString() } });
      if (enqueueOnFailure && normalized.retryable) {
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

  async applyRemoteUpdate(payload: Record<string, unknown>, matchedOrder?: ShopOrder) {
    const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "");
    if (!code && !matchedOrder) throw new PancakeIntegrationError("Dữ liệu Pancake thiếu mã đơn website.", "REMOTE_ORDER_CODE_MISSING", 400);
    const order = matchedOrder || await findOrderByCode(code);
    if (!order) throw new PancakeIntegrationError(`Không tìm thấy đơn ${code}.`, "ORDER_NOT_FOUND", 404);
    const pancakeStatus = value(payload, ["status", "order_status", "state"]);
    const mapped = mapPancakeStatus(pancakeStatus);
    const logisticsStatus = logisticsShippingStatus(payload);
    const synchronizedShippingStatus = latestShippingStatus(order.shippingStatus, logisticsStatus || mapped.shippingStatus);
    const preserveCancellation = order.status === "cancelled" && mapped.pancakeStatus !== "cancelled";
    if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
      await new InventoryService().reserve(order.items, "restore");
    }
    const updated = await updateOrder(order.code, {
      ...(mapped.status === "cancelled" && order.status !== "cancelled" ? { status: "cancelled" as const } : {}),
      ...(synchronizedShippingStatus && !preserveCancellation && order.deliveryType !== "express" ? { shippingStatus: synchronizedShippingStatus } : {}),
      ...(mapped.pancakeStatus && !preserveCancellation ? { pancakeStatus: mapped.pancakeStatus } : {}),
      ...(order.deliveryType !== "express" && hasShippingDetails(payload) && !preserveCancellation
        ? shippingUpdate(payload, false)
        : {}),
      inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
      externalSync: { ...order.externalSync, pancake: `Pancake: ${pancakeStatus || "đã cập nhật"}`, lastSyncedAt: new Date().toISOString() }
    });
    await PancakeLogger.write("info", "order.status", `Đã nhận trạng thái ${pancakeStatus || "không rõ"}.`, order.code);
    return updated;
  }

  async pollStatuses(options: { detailLimit?: number } = {}) {
    const remote = remoteRecords(await this.pancake.allOrders());
    const localOrders = await readOrders();
    const localByCode = new Map<string, ShopOrder>();
    const localByPancakeId = new Map<string, ShopOrder>();
    for (const order of localOrders) {
      localByCode.set(order.code.trim().toUpperCase(), order);
      localByCode.set(shortOrderCode(order.code), order);
      if (order.posOrderCode) localByCode.set(order.posOrderCode.trim().toUpperCase(), order);
      const providerId = pancakeOrderId(order).trim().toUpperCase();
      if (providerId) localByPancakeId.set(providerId, order);
    }
    let updated = 0;
    let posStatusesUpdated = 0;
    const patches = new Map<string, Partial<ShopOrder>>();
    const finalDetailStatuses = new Set<ShippingStatus>(["delivered", "returned", "cancelled"]);
    const detailLimit = Math.max(0, Math.floor(options.detailLimit ?? 20));
    const rotatingDetailLimit = remote.length ? Math.min(remote.length, detailLimit) : 0;
    const detailStart = remote.length && rotatingDetailLimit ? (Math.floor(Date.now() / 15000) * rotatingDetailLimit) % remote.length : 0;
    const orderedRemote = [...remote.slice(detailStart), ...remote.slice(0, detailStart)];
    const priorityDetailTargets = localOrders.flatMap((order) => {
      const remoteId = pancakeOrderId(order).trim();
      if (!remoteId || order.deliveryType === "express" || order.status === "cancelled") return [];
      if (order.trackingCode && finalDetailStatuses.has(order.shippingStatus || "unknown")) return [];
      return [{ remoteId, remoteKey: remoteId.toUpperCase(), order }];
    });
    const rotatingDetailTargets = orderedRemote.flatMap((payload) => {
      const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "").trim().toUpperCase();
      const remoteId = externalId(payload).trim();
      const remoteKey = remoteId.toUpperCase();
      const order = localByCode.get(code) || localByPancakeId.get(remoteKey);
      if (!order || !remoteId || (order.trackingCode && finalDetailStatuses.has(order.shippingStatus || "unknown"))) return [];
      return [{ remoteId, remoteKey, order }];
    });
    const detailTargetsByKey = new Map<string, { remoteId: string; remoteKey: string; order: ShopOrder }>();
    for (const target of [...priorityDetailTargets, ...rotatingDetailTargets]) {
      if (detailTargetsByKey.size >= detailLimit) break;
      if (!detailTargetsByKey.has(target.remoteKey)) detailTargetsByKey.set(target.remoteKey, target);
    }
    const detailTargets = Array.from(detailTargetsByKey.values());
    const detailByRemoteId = new Map<string, Record<string, unknown>>();
    const detailFailures: string[] = [];
    const posStatusFailures: string[] = [];
    const detailBatchSize = 16;
    for (let index = 0; index < detailTargets.length; index += detailBatchSize) {
      const batch = detailTargets.slice(index, index + detailBatchSize);
      const responses = await Promise.all(batch.map(async ({ remoteId, remoteKey, order }) => {
        try {
          return { remoteKey, payload: await this.pancake.order(remoteId) };
        } catch (error) {
          detailFailures.push(`${shortOrderCode(order.code)}: ${ExceptionHandler.message(error)}`);
          return null;
        }
      }));
      responses.forEach((response) => {
        if (response) detailByRemoteId.set(response.remoteKey, response.payload);
      });
    }
    const applyPayload = async (payload: Record<string, unknown>, order: ShopOrder, fallbackRemoteOrderId = "") => {
      const remoteOrderId = (externalId(payload) || fallbackRemoteOrderId).trim();
      const remoteId = remoteOrderId.toUpperCase();
      const mapped = mapPancakeStatus(value(payload, ["status", "order_status", "state"]));
      const logisticsStatus = logisticsShippingStatus(payload);
      const synchronizedShippingStatus = latestShippingStatus(order.shippingStatus, logisticsStatus || mapped.shippingStatus);
      const remoteShipping = hasShippingDetails(payload) ? shippingUpdate(payload, false) : {};
      const targetPosStatus = logisticsStatus === "delivered" ? 3 : logisticsStatus === "shipping" ? 2 : 0;
      const needsPosTransition = Boolean(targetPosStatus && remoteId
        && order.status !== "cancelled"
        && !["shipping", "completed"].includes(mapped.pancakeStatus || ""));
      const changed = Boolean(
        (mapped.status === "cancelled" && order.status !== "cancelled")
        || (mapped.pancakeStatus && mapped.pancakeStatus !== order.pancakeStatus)
        || (remoteOrderId && remoteOrderId !== pancakeOrderId(order))
        || (synchronizedShippingStatus && synchronizedShippingStatus !== order.shippingStatus)
        || ("trackingCode" in remoteShipping && remoteShipping.trackingCode && remoteShipping.trackingCode !== order.trackingCode)
        || ("shippingCarrier" in remoteShipping && remoteShipping.shippingCarrier && remoteShipping.shippingCarrier !== order.shippingCarrier)
        || needsPosTransition
      );
      if (!changed) return;
      const preserveCancellation = order.status === "cancelled" && mapped.pancakeStatus !== "cancelled";
      if (mapped.release && order.inventoryReservationApplied && !order.inventoryReservationReleased) {
        await new InventoryService().reserve(order.items, "restore");
      }
      patches.set(order.code, {
        ...(remoteOrderId ? { pancakeOrderId: remoteOrderId } : {}),
        ...(mapped.status === "cancelled" && order.status !== "cancelled" ? { status: "cancelled" as const } : {}),
        ...(synchronizedShippingStatus && !preserveCancellation && order.deliveryType !== "express"
          ? { shippingStatus: synchronizedShippingStatus }
          : {}),
        ...(mapped.pancakeStatus && !preserveCancellation ? { pancakeStatus: mapped.pancakeStatus } : {}),
        ...(order.deliveryType !== "express" && hasShippingDetails(payload) && !preserveCancellation
          ? shippingUpdate(payload, false)
          : {}),
        inventoryReservationReleased: Boolean(order.inventoryReservationReleased || mapped.release),
        externalSync: {
          pancake: `Pancake: ${value(payload, ["status", "order_status", "state"]) || "đã cập nhật"}`,
          lastSyncedAt: new Date().toISOString()
        }
      });

      if (needsPosTransition && !preserveCancellation) {
        try {
          await this.pancake.updateOrderStatus(remoteOrderId, targetPosStatus);
          posStatusesUpdated += 1;
          const currentPatch = patches.get(order.code) || {};
          patches.set(order.code, {
            ...currentPatch,
            pancakeStatus: targetPosStatus === 3 ? "completed" : "shipping"
          });
        } catch (error) {
          posStatusFailures.push(`${shortOrderCode(order.code)}: ${ExceptionHandler.message(error)}`);
        }
      }
      updated += 1;
    };
    const processedCodes = new Set<string>();
    for (const summaryPayload of orderedRemote) {
      let payload = summaryPayload;
      const code = value(payload, ["custom_id", "partner_order_id", "external_order_id", "order_code", "code"]).replace(/^BLANWHI:/i, "").trim().toUpperCase();
      const remoteOrderId = externalId(payload).trim();
      const remoteId = remoteOrderId.toUpperCase();
      const order = localByCode.get(code) || localByPancakeId.get(remoteId);
      if (!order) continue;
      payload = detailByRemoteId.get(remoteId) || payload;
      await applyPayload(payload, order, remoteOrderId);
      processedCodes.add(order.code);
    }
    for (const target of detailTargets) {
      if (processedCodes.has(target.order.code)) continue;
      const payload = detailByRemoteId.get(target.remoteKey);
      if (!payload) continue;
      await applyPayload(payload, target.order, target.remoteId);
    }
    if (patches.size) {
      const latestOrders = await readOrders();
      const updatedAt = new Date().toISOString();
      await writeOrders(latestOrders.map((order) => {
        const patch = patches.get(order.code);
        if (!patch) return order;
        return {
          ...order,
          ...patch,
          externalSync: { ...order.externalSync, ...patch.externalSync },
          updatedAt
        };
      }));
      await PancakeLogger.write("info", "order.poll", `Đã cập nhật nhanh ${patches.size} đơn và tự chuyển ${posStatusesUpdated} trạng thái POS.`);
    }
    if (detailFailures.length || posStatusFailures.length) {
      await PancakeLogger.write(
        "error",
        "order.poll",
        [
          detailFailures.length ? `${detailFailures.length} lỗi đọc chi tiết (${detailFailures.slice(0, 3).join("; ")})` : "",
          posStatusFailures.length ? `${posStatusFailures.length} lỗi chuyển POS (${posStatusFailures.slice(0, 3).join("; ")})` : ""
        ].filter(Boolean).join(" | ")
      );
    }
    return {
      received: remote.length,
      detailed: detailByRemoteId.size,
      detailErrors: detailTargets.length - detailByRemoteId.size,
      updated,
      posStatusesUpdated,
      posStatusErrors: posStatusFailures.length
    };
  }
}
