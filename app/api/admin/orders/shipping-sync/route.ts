import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders, updateOrder } from "@/lib/orders";
import { fetchShippingStatus } from "@/lib/shipping-providers";
import { OrderService } from "@/lib/services/order-service";

const finalShippingStatuses = new Set(["delivered", "returning", "returned", "cancelled"]);

async function syncShippingOrders() {
  const config = await readIntegrationConfig();
  const orders = await readOrders();
  const candidates = orders.filter((order) => !finalShippingStatuses.has(order.shippingStatus || "") && order.status !== "cancelled" && (order.deliveryType === "express" ? Boolean(order.deliveryOrderId) : Boolean(order.trackingCode)));

  const results = [];
  for (const order of candidates) {
    try {
      if (order.deliveryType === "express") {
        const updated = await new OrderService().trackExpressDelivery(order.code);
        results.push({ code: order.code, ok: true, status: updated.shippingStatus, message: updated.shippingMessage });
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

  if (!config.shipping.enabled && !candidates.some((order) => order.deliveryType === "express")) {
    return NextResponse.json({ error: "Chưa bật cập nhật API vận chuyển." }, { status: 400 });
  }
  return NextResponse.json({ checked: candidates.length, success: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length, results }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET() { return syncShippingOrders(); }
export async function POST() { return syncShippingOrders(); }
