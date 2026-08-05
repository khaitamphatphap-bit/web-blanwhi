import { NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { readIntegrationConfig } from "@/lib/integrations";
import { reconcileZaloPayPayment, reconcileZaloPayRefund } from "@/lib/payment-confirmation";

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
    const requested = orders.filter((order) => allowed.has(order.code));
    const integrations = await readIntegrationConfig();
    await Promise.allSettled(requested.map(async (order) => {
      let current = order;
      if (current.status === "pending" && current.paymentMethod === "zalopay") {
        current = await reconcileZaloPayPayment(current, integrations.payment);
      }
      if (current.refundStatus === "pending" && current.paymentMethod === "zalopay") {
        await reconcileZaloPayRefund(current, integrations.payment);
      }
    }));
    const paymentRefreshed = await readOrders();
    const paidRequested = paymentRefreshed.filter((order) => allowed.has(order.code)
      && order.status === "paid"
      && !["delivered", "returned", "cancelled"].includes(order.shippingStatus || ""));
    const sync = new OrderSyncService();
    await Promise.allSettled(paidRequested.map((order) => sync.reconcileExisting(order)));
    const refreshedOrders = await readOrders();
    return NextResponse.json({
      orders: refreshedOrders
        .filter((order) => allowed.has(order.code))
        .map((order) => ({
          code: order.code,
          status: order.status,
          paymentMethod: order.paymentMethod,
          paymentProvider: order.paymentProvider,
          transactionId: order.transactionId,
          refundStatus: order.refundStatus,
          refundMessage: order.refundMessage,
          refundAmount: order.refundAmount,
          refundedAt: order.refundedAt,
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
