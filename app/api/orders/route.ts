import { NextResponse } from "next/server";
import { readOrders, updateOrder } from "@/lib/orders";

export async function GET(request: Request) {
  let orders = await readOrders();
  const invalidUnpaidRefunds = orders.filter((order) => order.status === "cancelled"
    && order.paymentMethod === "zalopay"
    && !order.transactionId
    && order.refundStatus !== "not_required");
  if (invalidUnpaidRefunds.length) {
    await Promise.all(invalidUnpaidRefunds.map((order) => updateOrder(order.code, {
      refundStatus: "not_required",
      refundProvider: undefined,
      refundId: undefined,
      refundTransactionId: undefined,
      refundAmount: undefined,
      refundMessage: ""
    })));
    orders = await readOrders();
  }
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean)
    .slice(0, 100);

  if (codes.length) {
    const allowed = new Set(codes);
    const requested = orders.filter((order) => allowed.has(order.code));
    return NextResponse.json({
      orders: requested
        .map((order) => ({
          code: order.code,
          createdAt: order.createdAt,
          status: order.status,
          paymentMethod: order.paymentMethod,
          paymentProvider: order.paymentProvider,
          transactionId: order.transactionId,
          refundStatus: order.refundStatus,
          refundMessage: order.refundMessage,
          refundAmount: order.refundAmount,
          refundedAt: order.refundedAt,
          paymentExpiredAt: order.paymentExpiredAt,
          cancellationReason: order.cancellationReason,
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

  return NextResponse.json({ orders }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
