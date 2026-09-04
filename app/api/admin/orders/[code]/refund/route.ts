import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode } from "@/lib/orders";
import { requestAutomaticZaloPayRefund } from "@/lib/zalopay-refund-service";

type Params = { params: Promise<{ code: string }> };

export async function POST(_request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (order.status !== "cancelled") return NextResponse.json({ error: "Chỉ hoàn tiền cho đơn đã hủy." }, { status: 409 });
    if (order.paymentMethod !== "zalopay" || !order.transactionId) {
      return NextResponse.json({ error: "Đơn chưa có giao dịch ZaloPay đã thanh toán để hoàn tiền." }, { status: 409 });
    }
    const result = await requestAutomaticZaloPayRefund(order, await readIntegrationConfig(), "Hoan tien don hang da huy");
    return NextResponse.json({ ok: true, order: result });
  } catch (error) {
    return jsonError(error);
  }
}
