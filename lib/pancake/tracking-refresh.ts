import { findOrderByCode, updateOrder } from "@/lib/orders";
import { PancakeLogger } from "@/lib/pancake/logger";
import { PancakeService } from "@/lib/pancake/pancake-service";
import { buildTrackingOnlyPatch, extractPancakeSystemId, extractPancakeTracking } from "@/lib/pancake/tracking";
import type { ShopOrder } from "@/lib/types";

type RefreshOptions = {
  force?: boolean;
  limit?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  rotate?: boolean;
  source?: string;
};

const checkStates = new Map<string, { attempts: number; nextAllowedAt: number }>();
const inFlightChecks = new Map<string, Promise<ShopOrder>>();

function activeMissingTracking(order: ShopOrder) {
  return order.deliveryType !== "express"
    && order.status !== "cancelled"
    && !["delivered", "returned", "cancelled"].includes(order.shippingStatus || "")
    && !String(order.trackingCode || "").trim()
    && Boolean(String(order.pancakeOrderId || "").trim());
}

function bounded(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export async function refreshPancakeTrackingOnly(
  order: ShopOrder,
  options: Pick<RefreshOptions, "timeoutMs" | "source"> = {},
  pancake = new PancakeService()
) {
  if (!activeMissingTracking(order)) return order;
  const remoteId = String(order.pancakeOrderId || "").trim();
  const timeoutMs = bounded(options.timeoutMs, 4000, 1500, 10_000);
  let payload: unknown;
  let detailError: unknown;
  try {
    payload = await pancake.order(remoteId, { attempts: 1, timeoutMs });
  } catch (error) {
    detailError = error;
    payload = {};
  }
  let snapshot = extractPancakeTracking(payload);
  const systemId = extractPancakeSystemId(payload) || remoteId;
  if (!snapshot.trackingCode) {
    try {
      const trackingPayload = await pancake.tracking(systemId, { timeoutMs });
      payload = { order_details: payload, tracking_lookup: trackingPayload };
      snapshot = extractPancakeTracking(payload);
    } catch (trackingError) {
      if (detailError) throw detailError;
      if (!(payload && typeof payload === "object" && Object.keys(payload as Record<string, unknown>).length)) throw trackingError;
    }
  }
  if (!snapshot.trackingCode) return order;

  const current = await findOrderByCode(order.code) || order;
  const patch = buildTrackingOnlyPatch(current, snapshot);
  if (!patch) return current;
  if (current.trackingCode === patch.trackingCode
    && current.shippingCarrier === patch.shippingCarrier
    && current.shippingStatus === patch.shippingStatus
    && (!patch.deliveryTrackingUrl || current.deliveryTrackingUrl === patch.deliveryTrackingUrl)) return current;

  const updated = await updateOrder(current.code, {
    ...patch,
    externalSync: {
      ...current.externalSync,
      shipping: `${options.source || "Pancake"}: đã nhận mã vận đơn ${patch.trackingCode}`,
      lastSyncedAt: new Date().toISOString()
    }
  });
  if (updated) await PancakeLogger.write("info", "order.tracking", `Đã cập nhật mã vận đơn ${patch.trackingCode} từ ${options.source || "Pancake"}.`, current.code);
  return updated || current;
}

export async function refreshMissingPancakeTracking(orders: ShopOrder[], options: RefreshOptions = {}) {
  const limit = bounded(options.limit, 3, 1, 30);
  const minIntervalMs = bounded(options.minIntervalMs, 30_000, 10_000, 300_000);
  const now = Date.now();
  let eligible = orders.filter(activeMissingTracking);
  if (options.rotate && eligible.length > limit) {
    const start = (Math.floor(now / 300_000) * limit) % eligible.length;
    eligible = [...eligible.slice(start), ...eligible.slice(0, start)];
  }
  const targets = eligible.filter((order) => options.force || (checkStates.get(order.code)?.nextAllowedAt || 0) <= now).slice(0, limit);
  const refreshed = await Promise.all(targets.map(async (order) => {
    const existing = inFlightChecks.get(order.code);
    if (existing) return existing;
    const previousAttempts = checkStates.get(order.code)?.attempts || 0;
    checkStates.set(order.code, { attempts: previousAttempts, nextAllowedAt: now + minIntervalMs });
    const task = refreshPancakeTrackingOnly(order, options)
      .then((result) => {
        if (result.trackingCode) {
          checkStates.delete(order.code);
          return result;
        }
        const attempts = previousAttempts + 1;
        const backoff = attempts <= 3 ? 10_000 : attempts <= 6 ? 30_000 : 120_000;
        checkStates.set(order.code, { attempts, nextAllowedAt: Date.now() + Math.max(minIntervalMs, backoff) });
        return result;
      })
      .catch(async (error) => {
        checkStates.set(order.code, { attempts: previousAttempts + 1, nextAllowedAt: Date.now() + Math.max(minIntervalMs, 60_000) });
        await PancakeLogger.write("warning", "order.tracking", error instanceof Error ? error.message : "Không đọc được mã vận đơn Pancake.", order.code);
        return order;
      })
      .finally(() => {
        inFlightChecks.delete(order.code);
      });
    inFlightChecks.set(order.code, task);
    return task;
  }));
  if (checkStates.size > 2000) {
    for (const [code, state] of checkStates) if (state.nextAllowedAt <= now) checkStates.delete(code);
  }
  const byCode = new Map(refreshed.map((order) => [order.code, order]));
  return orders.map((order) => byCode.get(order.code) || order);
}
