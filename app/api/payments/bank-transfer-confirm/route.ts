import { NextResponse } from "next/server";
import { findOrderByCode, updateOrderStatus } from "@/lib/orders";

export async function POST(request: Request) {
  const body = (await request.json()) as { orderCode?: string };
  const orderCode = body.orderCode?.trim();

  if (!orderCode) {
    return NextResponse.json({ error: "Missing orderCode" }, { status: 400 });
  }

  const order = await findOrderByCode(orderCode);
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paymentMethod !== "bank_transfer") {
    return NextResponse.json({ error: "Order is not a bank transfer order" }, { status: 400 });
  }

  const updated = await updateOrderStatus(orderCode, "paid", {
    transactionId: `BANK-${Date.now()}`,
    providerOrderId: orderCode,
    providerMessage: "Khach da xac nhan chuyen khoan tren website"
  });

  return NextResponse.json({ order: updated });
}
