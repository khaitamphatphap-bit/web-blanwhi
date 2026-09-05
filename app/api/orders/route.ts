import { NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";
import { refreshMissingPancakeTracking } from "@/lib/pancake/tracking-refresh";

export async function GET(request: Request) {
  const orders = await readOrders();
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (codes.length) {
    const allowed = new Set(codes);
    const requested = await refreshMissingPancakeTracking(
      orders.filter((order) => allowed.has(order.code)),
      { limit: 3, minIntervalMs: 10_000, timeoutMs: 3500, source: "Khách xem đơn" }
    );
    return NextResponse.json({
      orders: requested
        .map((order) => ({
          code: order.code,
          createdAt: order.createdAt,
          status: order.status,
          paymentMethod: order.paymentMethod,
          paymentProvider: order.paymentProvider,
          transactionId: order.transactionId || "",
          refundStatus: order.refundStatus || null,
          refundMessage: order.refundMessage || "",
          refundAmount: order.refundAmount || 0,
          refundedAt: order.refundedAt || "",
          paymentExpiredAt: order.paymentExpiredAt || "",
          cancellationReason: order.cancellationReason || "",
          shippingCarrier: order.shippingCarrier || "",
          trackingCode: order.trackingCode || "",
          shippingStatus: order.shippingStatus || "not_created",
          shippingMessage: order.shippingMessage || "",
          deliveryType: order.deliveryType || null,
          deliveryProvider: order.deliveryProvider || "",
          deliveryOrderId: order.deliveryOrderId || "",
          deliveryDriver: order.deliveryDriver || null,
          deliveryTrackingUrl: order.deliveryTrackingUrl || "",
          deliveryFeeActual: order.deliveryFeeActual || 0,
          pancakeStatus: order.pancakeStatus || null,
          updatedAt: order.updatedAt
        }))
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }

  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
