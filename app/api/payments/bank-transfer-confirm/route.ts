import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { findOrderByCode } from "@/lib/orders";

export async function POST(request: Request) {
  try {
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

    return NextResponse.json({
      error: "Chưa nhận được xác nhận giao dịch từ ngân hàng. Đơn vẫn ở trạng thái chờ thanh toán để tránh ghi nhận nhầm."
    }, { status: 409 });
  } catch (error) {
    return jsonError(error);
  }
}
