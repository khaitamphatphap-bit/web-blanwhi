import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrderStatus } from "@/lib/orders";
import { confirmVerifiedPayment } from "@/lib/services/payment-confirmation-service";
import { verifyVnpayParams } from "@/lib/payment";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const integrations = await readIntegrationConfig();
  const verified = verifyVnpayParams(url.searchParams, integrations.payment);
  if (!verified.ok) {
    return NextResponse.json({ RspCode: "97", Message: verified.reason });
  }

  const orderCode = url.searchParams.get("vnp_TxnRef") ?? "";
  const amount = Number(url.searchParams.get("vnp_Amount") ?? 0) / 100;
  const responseCode = url.searchParams.get("vnp_ResponseCode");
  const transactionNo = url.searchParams.get("vnp_TransactionNo") ?? undefined;
  const order = await findOrderByCode(orderCode);

  if (!order) return NextResponse.json({ RspCode: "01", Message: "Order not found" });
  if (order.total !== amount) return NextResponse.json({ RspCode: "04", Message: "Invalid amount" });
  if (order.status === "paid") return NextResponse.json({ RspCode: "02", Message: "Order already confirmed" });

  if (responseCode === "00") {
    await confirmVerifiedPayment(orderCode, {
      transactionId: transactionNo,
      providerMessage: "VNPAY payment success"
    });
  } else {
    await updateOrderStatus(orderCode, "failed", { providerMessage: `VNPAY response ${responseCode}` });
  }

  return NextResponse.json({ RspCode: "00", Message: "Confirm Success" });
}
