import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode } from "@/lib/orders";
import { verifyZaloPayBody } from "@/lib/payment";
import { markVerifiedPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";
import { recordPaymentOrphan } from "@/lib/payment-orphans";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const integrations = await readIntegrationConfig();
    const verified = verifyZaloPayBody(body, integrations.payment);
    if (!verified.ok) {
      return NextResponse.json({ return_code: -1, return_message: verified.reason });
    }

    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(body.data ?? "{}")) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ return_code: -1, return_message: "Invalid callback data" });
    }

    const appTransId = String(data.app_trans_id ?? "");
    const transIdParts = appTransId.split("_");
    const orderCode = transIdParts[1]?.startsWith("R") ? transIdParts.slice(2).join("_") : transIdParts.slice(1).join("_");
    const amount = Number(data.amount ?? 0);
    const transactionId = data.zp_trans_id ? String(data.zp_trans_id) : undefined;
    const order = await findOrderByCode(orderCode);

    if (!order) {
      await recordPaymentOrphan({
        provider: "zalopay",
        orderCode,
        appTransId,
        transactionId,
        amount,
        reason: "order_not_found",
        message: "ZaloPay báo thanh toán thành công nhưng website không tìm thấy đơn tương ứng.",
        payload: data
      });
      return NextResponse.json({ return_code: 0, return_message: "Order not found" });
    }
    if (order.total !== amount) {
      await recordPaymentOrphan({
        provider: "zalopay",
        orderCode,
        appTransId,
        transactionId,
        amount,
        reason: "amount_mismatch",
        message: `ZaloPay báo số tiền ${amount} nhưng đơn website là ${order.total}.`,
        payload: data
      });
      return NextResponse.json({ return_code: 0, return_message: "Invalid amount" });
    }

    const paid = await markVerifiedPayment(orderCode, {
      transactionId,
      paymentProviderOrderId: appTransId,
      providerMessage: "ZaloPay payment success"
    });
    after(() => syncVerifiedOrderToPos(paid));

    return NextResponse.json({ return_code: 1, return_message: "success" });
  } catch (error) {
    const response = jsonError(error);
    const body = await response.json();
    return NextResponse.json({ return_code: -1, return_message: body.error }, { status: response.status });
  }
}
