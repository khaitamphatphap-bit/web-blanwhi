import { NextResponse } from "next/server";
import { applyExternalOrderUpdate, externalOrderCode } from "@/lib/order-webhook";
import { findOrderByCode } from "@/lib/orders";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({}));
  const orderCode = externalOrderCode(payload);
  if (!orderCode) return NextResponse.json({ error: "Thiếu mã đơn." }, { status: 400 });

  const order = await findOrderByCode(orderCode);
  if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });

  const updated = await applyExternalOrderUpdate(order, payload, "misa");
  return NextResponse.json({ ok: true, order: updated });
}
