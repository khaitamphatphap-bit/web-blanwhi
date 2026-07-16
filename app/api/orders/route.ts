import { NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";

export async function GET(request: Request) {
  const orders = await readOrders();
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (codes.length) {
    const allowed = new Set(codes);
    const requested = orders.filter((order) => allowed.has(order.code)
      && !["cancelled", "failed"].includes(order.status)
      && !["delivered", "returned", "cancelled"].includes(order.shippingStatus || ""));
    const sync = new OrderSyncService();
    await Promise.allSettled(requested.map((order) => sync.reconcileExisting(order)));
    const refreshedOrders = await readOrders();
    return NextResponse.json({
      orders: refreshedOrders
        .filter((order) => allowed.has(order.code))
        .map((order) => ({
          code: order.code,
          status: order.status,
          shippingCarrier: order.shippingCarrier,
          trackingCode: order.trackingCode,
          shippingStatus: order.shippingStatus,
          shippingMessage: order.shippingMessage,
          deliveryType: order.deliveryType,
          deliveryProvider: order.deliveryProvider,
          deliveryOrderId: order.deliveryOrderId,
          deliveryDriver: order.deliveryDriver,
          deliveryTrackingUrl: order.deliveryTrackingUrl,
          deliveryFeeActual: order.deliveryFeeActual,
          pancakeStatus: order.pancakeStatus,
          updatedAt: order.updatedAt
        }))
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }

  return NextResponse.json({ orders });
}
