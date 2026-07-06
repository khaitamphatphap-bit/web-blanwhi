import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders, updateOrder } from "@/lib/orders";
import { fetchShippingStatus } from "@/lib/shipping-providers";

const finalShippingStatuses = new Set(["delivered", "returning", "returned", "cancelled"]);

async function syncShippingOrders() {
  const config = await readIntegrationConfig();
  if (!config.shipping.enabled) {
    return NextResponse.json({ error: "Chưa bật cập nhật API vận chuyển." }, { status: 400 });
  }

  const orders = await readOrders();
  const candidates = orders.filter((order) =>
    order.trackingCode &&
    !finalShippingStatuses.has(order.shippingStatus || "") &&
    order.status !== "cancelled"
  );

  const results = [];
  for (const order of candidates) {
    try {
      const result = await fetchShippingStatus(config.shipping, order);
      await updateOrder(order.code, {
        shippingCarrier: result.carrier,
        trackingCode: result.trackingCode,
        shippingStatus: result.status,
        shippingMessage: result.message,
        externalSync: {
          ...order.externalSync,
          shipping: `${result.carrier}: ${result.message || result.status} (${new Date().toLocaleString("vi-VN")})`,
          lastSyncedAt: new Date().toISOString()
        }
      });
      results.push({ code: order.code, ok: true, status: result.status, message: result.message });
    } catch (error) {
      results.push({
        code: order.code,
        ok: false,
        error: error instanceof Error ? error.message : "Không cập nhật được vận chuyển."
      });
    }
  }

  return NextResponse.json({
    checked: candidates.length,
    success: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}

export async function GET() {
  return syncShippingOrders();
}

export async function POST() {
  return syncShippingOrders();
}
