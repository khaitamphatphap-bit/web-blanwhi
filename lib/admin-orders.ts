import { adminOrderLooksRecovered, buildAdminOrderView, selectAuthoritativeAdminHistory, type AdminOrderObservation, type AdminShopOrder } from "./admin-order-view";
import { readJsonStoreHistory, readKeyedJsonStore, readKeyedJsonStoreHistory, writeKeyedJsonRecord } from "./data-store";
import { readIntegrationConfig } from "./integrations";
import { readOrders } from "./orders";
import { queryZaloPayPayment } from "./payment";
import { mapPancakeStatus } from "./pancake/domain";
import { PancakeService } from "./pancake/pancake-service";
import { deepPancakeText, extractPancakeSystemId, extractPancakeTracking } from "./pancake/tracking";
import type { ShopOrder } from "./types";

const observationStore = "admin-order-observations";

function text(value: unknown) {
  return String(value || "").trim();
}

function historyByCode(histories: ShopOrder[]) {
  const grouped = new Map<string, ShopOrder[]>();
  histories.forEach((order) => {
    const code = text(order?.code).toUpperCase();
    if (!code) return;
    grouped.set(code, [...(grouped.get(code) || []), order]);
  });
  return grouped;
}

export async function readAdminOrders(): Promise<AdminShopOrder[]> {
  const [orders, histories, observations] = await Promise.all([
    readOrders(),
    readKeyedJsonStoreHistory<ShopOrder>("order-records", undefined, 1000),
    readKeyedJsonStore<AdminOrderObservation>(observationStore, {})
  ]);
  const grouped = historyByCode(histories);
  return orders.map((order) => buildAdminOrderView(
    order,
    grouped.get(order.code.toUpperCase()) || [],
    observations[order.code.toUpperCase()]
  ));
}

function numericValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => boolean, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 6) return false;
  if (!Array.isArray(value) && visit(value as Record<string, unknown>)) return true;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.some((child) => walkRecords(child, visit, depth + 1));
}

function pancakeConfirmsPaid(payload: unknown, expectedAmount: number) {
  const paidTexts = new Set(["paid", "completed", "success", "successful", "succeeded", "đã_thanh_toán", "da_thanh_toan", "thanh_toan_thanh_cong"]);
  const normalize = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, "_");
  const paymentKeys = ["payment_status", "paymentStatus", "payment_state", "paid_status", "financial_status"];
  const prepaidKeys = ["prepaid", "prepaid_amount", "prepaidAmount", "money_transfer", "paid_amount", "paidAmount"];
  const codKeys = ["cod", "cod_amount", "codAmount", "cash_on_delivery", "cashOnDelivery"];
  return walkRecords(payload, (record) => {
    if (paymentKeys.some((key) => key in record && paidTexts.has(normalize(record[key])))) return true;
    if (["is_paid", "isPaid", "paid"].some((key) => record[key] === true || record[key] === 1 || normalize(record[key]) === "true")) return true;
    const prepaid = prepaidKeys.reduce((maximum, key) => Math.max(maximum, numericValue(record[key])), 0);
    const cod = codKeys.reduce((maximum, key) => Math.max(maximum, numericValue(record[key])), 0);
    return expectedAmount > 0 && prepaid >= expectedAmount && cod === 0;
  });
}

function providerOrderId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  const nestedOrder = record.order && typeof record.order === "object" && !Array.isArray(record.order)
    ? record.order as Record<string, unknown>
    : undefined;
  return text(record.id || record.order_id || record.orderId || nestedOrder?.id);
}

function appTransIdFromCode(code: string) {
  const match = /^BLW-(\d{6})/.exec(text(code).toUpperCase());
  return match ? `${match[1]}_${text(code).toUpperCase()}` : "";
}

async function reconcileOne(order: ShopOrder, histories: ShopOrder[], current?: AdminOrderObservation) {
  const now = new Date().toISOString();
  const canonicalOrder = current?.canonicalOrder || selectAuthoritativeAdminHistory(order, histories) || undefined;
  let observation: AdminOrderObservation = {
    ...current,
    orderCode: order.code,
    canonicalOrder,
    updatedAt: now,
    warning: ""
  };
  let view = buildAdminOrderView(order, histories, observation);

  if (view.adminPaymentStatus === "paid" || view.adminPaymentStatus === "refunded") {
    observation = {
      ...observation,
      paymentStatus: view.adminPaymentStatus,
      paymentSource: view.adminPaymentSource,
      paymentAmount: view.adminPaymentAmount,
      transactionId: view.transactionId,
      paymentProviderOrderId: view.paymentProviderOrderId,
      paymentCheckedAt: now
    };
  } else if (view.paymentMethod === "zalopay" && view.adminPaymentStatus === "pending") {
    try {
      const integrations = await readIntegrationConfig();
      const candidate = {
        ...view,
        paymentProviderOrderId: view.paymentProviderOrderId || appTransIdFromCode(view.code)
      };
      const payment = await queryZaloPayPayment(candidate, integrations.payment);
      if (Number(payment.return_code) === 1 && payment.zp_trans_id && Number(payment.amount || 0) === Number(view.total)) {
        observation = {
          ...observation,
          paymentStatus: "paid",
          paymentSource: "ZaloPay production xác nhận",
          paymentAmount: Number(payment.amount),
          transactionId: text(payment.zp_trans_id),
          paymentProviderOrderId: payment.app_trans_id,
          paymentCheckedAt: now
        };
      } else {
        observation = {
          ...observation,
          paymentStatus: "pending",
          paymentSource: "ZaloPay chưa xác nhận",
          paymentCheckedAt: now
        };
      }
    } catch (error) {
      observation.warning = error instanceof Error ? `Chưa kiểm tra được ZaloPay: ${error.message}` : "Chưa kiểm tra được ZaloPay";
      observation.paymentCheckedAt = now;
    }
  }

  view = buildAdminOrderView(order, histories, observation);
  const shouldReadPancake = order.status !== "cancelled"
    && (Boolean(view.pancakeOrderId || view.pancakeStatus || view.externalSync?.pancake)
      || !view.trackingCode
      || view.adminPaymentStatus === "pending");
  if (shouldReadPancake) {
    try {
      const pancake = new PancakeService();
      if (pancake.configured()) {
        const found = view.pancakeOrderId
          ? null
          : await pancake.findOrder(view.code, view.customer.phone);
        const remoteId = text(view.pancakeOrderId) || providerOrderId(found);
        const detail = remoteId ? await pancake.order(remoteId, { attempts: 1, timeoutMs: 5000 }) : found;
        const systemId = extractPancakeSystemId(detail || found);
        const tracking = systemId ? await pancake.tracking(systemId, { timeoutMs: 5000 }).catch(() => null) : null;
        const payload = { found, detail, tracking };
        const trackingSnapshot = extractPancakeTracking(payload);
        const remoteStatus = deepPancakeText(payload, ["status", "order_status", "state"]);
        const mapped = mapPancakeStatus(remoteStatus);
        observation = {
          ...observation,
          pancakeOrderId: remoteId || observation.pancakeOrderId,
          pancakeStatus: mapped.pancakeStatus || observation.pancakeStatus,
          trackingCode: trackingSnapshot.trackingCode || observation.trackingCode,
          shippingCarrier: trackingSnapshot.carrier || observation.shippingCarrier,
          shippingStatus: trackingSnapshot.shippingStatus || mapped.shippingStatus || observation.shippingStatus,
          deliveryTrackingUrl: trackingSnapshot.trackingUrl || observation.deliveryTrackingUrl,
          shippingCheckedAt: now,
          updatedAt: now
        };
        if (view.paymentMethod === "zalopay" && view.adminPaymentStatus === "pending" && pancakeConfirmsPaid(payload, view.total)) {
          observation.paymentStatus = "paid";
          observation.paymentSource = "Pancake xác nhận đã thanh toán online";
          observation.paymentAmount = view.total;
          observation.paymentCheckedAt = now;
        }
      }
    } catch (error) {
      observation.warning = [observation.warning, error instanceof Error ? `Chưa đọc được Pancake: ${error.message}` : "Chưa đọc được Pancake"]
        .filter(Boolean)
        .join(" · ");
    }
  }

  await writeKeyedJsonRecord(observationStore, order.code.toUpperCase(), observation);
  return buildAdminOrderView(order, histories, observation);
}

export async function reconcileAdminOrders(codes: string[]) {
  const normalized = [...new Set(codes.map((code) => text(code).toUpperCase()).filter(Boolean))].slice(0, 12);
  const [orders, observations] = await Promise.all([
    readOrders(),
    readKeyedJsonStore<AdminOrderObservation>(observationStore, {})
  ]);
  const byCode = new Map(orders.map((order) => [order.code.toUpperCase(), order]));
  const requestedCodes = new Set(normalized);
  const needsLegacyHistory = normalized.some((code) => {
    const order = byCode.get(code);
    return Boolean(order && adminOrderLooksRecovered(order) && !observations[code]?.canonicalOrder);
  });
  const legacySnapshots = needsLegacyHistory
    ? await readJsonStoreHistory<ShopOrder[]>("orders.json", 100)
    : [];
  const legacyByCode = historyByCode(legacySnapshots
    .flatMap((snapshot) => Array.isArray(snapshot) ? snapshot : [])
    .filter((order) => requestedCodes.has(text(order?.code).toUpperCase())));
  const results: AdminShopOrder[] = [];
  for (let index = 0; index < normalized.length; index += 3) {
    const batch = normalized.slice(index, index + 3);
    const reconciled = await Promise.all(batch.map(async (code) => {
      const order = byCode.get(code);
      if (!order) return null;
      const keyedHistories = await readKeyedJsonStoreHistory<ShopOrder>("order-records", code, 100);
      const histories = [...keyedHistories, ...(legacyByCode.get(code) || [])];
      return reconcileOne(order, histories, observations[code]);
    }));
    results.push(...reconciled.filter((order): order is AdminShopOrder => Boolean(order)));
  }
  return results;
}
