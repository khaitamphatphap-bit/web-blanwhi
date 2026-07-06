import { NextResponse } from "next/server";
import { updateOrderStatus } from "@/lib/orders";
import { OrderStatus } from "@/lib/types";

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEMO_PAYMENTS !== "true") {
    return NextResponse.json({ error: "Demo payment is disabled in production." }, { status: 403 });
  }

  const body = (await request.json()) as { orderCode?: string; status?: OrderStatus };
  if (!body.orderCode || !body.status) {
    return NextResponse.json({ error: "Missing orderCode or status" }, { status: 400 });
  }
  if (!["paid", "failed", "cancelled"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const order = await updateOrderStatus(body.orderCode, body.status, {
    providerMessage: `Demo payment marked as ${body.status}`
  });

  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  return NextResponse.json({ order });
}
