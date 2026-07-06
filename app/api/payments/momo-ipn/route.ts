import { NextResponse } from "next/server";
import { findOrderByCode, updateOrderStatus } from "@/lib/orders";
import { verifyMomoBody } from "@/lib/payment";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const verified = verifyMomoBody(body);
  if (!verified.ok) {
    return NextResponse.json({ resultCode: 97, message: verified.reason });
  }

  const orderCode = String(body.orderId ?? "");
  const amount = Number(body.amount ?? 0);
  const resultCode = Number(body.resultCode ?? -1);
  const order = await findOrderByCode(orderCode);

  if (!order) return NextResponse.json({ resultCode: 1, message: "Order not found" });
  if (order.total !== amount) return NextResponse.json({ resultCode: 4, message: "Invalid amount" });

  await updateOrderStatus(orderCode, resultCode === 0 ? "paid" : "failed", {
    transactionId: body.transId ? String(body.transId) : undefined,
    providerOrderId: body.requestId ? String(body.requestId) : undefined,
    providerMessage: body.message ? String(body.message) : undefined
  });

  return NextResponse.json({ resultCode: 0, message: "Confirm Success" });
}
