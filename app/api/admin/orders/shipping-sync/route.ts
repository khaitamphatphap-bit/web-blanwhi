import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders, updateOrder } from "@/lib/orders";
import { fetchShippingStatus } from "@/lib/shipping-providers";
import { OrderService } from "@/lib/services/order-service";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { createJsonStoreBackup } from "@/lib/data-store";

const finalShippingStatuses = new Set(["delivered", "returning", "returned", "cancelled"]);

async function syncShippingOrders(request: Request) {
  const fullSync = new URL(request.url).searchParams.get("full") === "1";
  const config = await readIntegrationConfig();
  const orders = await readOrders();
  if (fullSync) {
    await createJsonStoreBackup("orders.json", orders, "before-full-shipping-sync");
  }
  const candidates = orders.filter((order) => !finalShippingStatuses.has(order.shippingStatus || "") && order.status !== "cancelled" && (order.deliveryType === "express"
    ? Boolean(order.deliveryOrderId)
    : Boolean(order.pancakeOrderId || order.pancakeStatus || order.providerOrderId || order.trackingCode)));

  const results = [];
  const pancakeCandidates = candidates.filter((order) => order.deliveryType !== "express" && Boolean(order.pancakeOrderId || order.pancakeStatus || order.providerOrderId));
  if (pancakeCandidates.length) {
    try {
      const synced = await new OrderSyncService().pollStatuses({ detailLimit: fullSync ? 200 : 20 });
      results.push({ code: "pancake-pos", ok: true, status: "synced", received: synced.received, detailed: synced.detailed, detailErrors: synced.detailErrors, updated: synced.updated, posStatusesUpdated: synced.posStatusesUpdated, posStatusErrors: synced.posStatusErrors, message: `Đã nhận ${synced.received} đơn từ POS, đọc chi tiết ${synced.detailed} đơn, cập nhật ${synced.updated} đơn và tự chuyển ${synced.posStatusesUpdated} trạng thái POS.` });
    } catch (error) {
      results.push({ code: "pancake-pos", ok: false, error: error instanceof Error ? error.message : "Không cập nhật được trạng thái Pancake POS." });
    }
  }
  for (const order of candidates) {
    try {
      if (order.deliveryType === "express") {
        const updated = await new OrderService().trackExpressDelivery(order.code);
        results.push({ code: order.code, ok: true, status: updated.shippingStatus, message: updated.shippingMessage });
        continue;
      }
      if (order.pancakeOrderId || order.pancakeStatus || order.providerOrderId) {
        continue;
      }
      if (!config.shipping.enabled) throw new Error("Chưa bật cập nhật API vận chuyển tiêu chuẩn.");
      const result = await fetchShippingStatus(config.shipping, order);
      await updateOrder(order.code, {
        shippingCarrier: result.carrier,
        trackingCode: result.trackingCode,
        shippingStatus: result.status,
        shippingMessage: result.message,
        externalSync: { ...order.externalSync, shipping: `${result.carrier}: ${result.message || result.status} (${new Date().toLocaleString("vi-VN")} )`, lastSyncedAt: new Date().toISOString() }
      });
      results.push({ code: order.code, ok: true, status: result.status, message: result.message });
    } catch (error) {
      results.push({ code: order.code, ok: false, error: error instanceof Error ? error.message : "Không cập nhật được vận chuyển." });
    }
  }

  if (!config.shipping.enabled && config.shipping.provider !== "shopee_express" && pancakeCandidates.length === 0 && !candidates.some((order) => order.deliveryType === "express")) {
    return NextResponse.json({ error: "Chưa bật cập nhật API vận chuyển." }, { status: 400 });
  }
  return NextResponse.json({
    checked: candidates.length,
    success: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    ordersUpdated: results.reduce((sum, result) => sum + ("updated" in result ? Number(result.updated || 0) : 0), 0),
    ordersDetailed: results.reduce((sum, result) => sum + ("detailed" in result ? Number(result.detailed || 0) : 0), 0),
    detailErrors: results.reduce((sum, result) => sum + ("detailErrors" in result ? Number(result.detailErrors || 0) : 0), 0),
    posStatusesUpdated: results.reduce((sum, result) => sum + ("posStatusesUpdated" in result ? Number(result.posStatusesUpdated || 0) : 0), 0),
    posStatusErrors: results.reduce((sum, result) => sum + ("posStatusErrors" in result ? Number(result.posStatusErrors || 0) : 0), 0),
    results
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: Request) { return syncShippingOrders(request); }
export async function POST(request: Request) { return syncShippingOrders(request); }
