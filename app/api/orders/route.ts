import { NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";

export async function GET(request: Request) {
  const orders = await readOrders();
  const url = new URL(request.url);
  const codes = (url.searchParams.get("codes") || "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (codes.length) {
    const allowed = new Set(codes);
    return NextResponse.json({
      orders: orders
        .filter((order) => allowed.has(order.code))
        .map((order) => ({
          code: order.code,
          status: order.status,
          shippingCarrier: order.shippingCarrier,
          trackingCode: order.trackingCode,
          shippingStatus: order.shippingStatus,
          shippingMessage: order.shippingMessage,
          updatedAt: order.updatedAt
        }))
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  }

  return NextResponse.json({ orders });
}
