import { NextResponse } from "next/server";
import { findOrderByPaymentProviderOrderId } from "@/lib/orders";
import { verifyPayOsWebhook } from "@/lib/payment";
import { confirmVerifiedPayment } from "@/lib/services/payment-confirmation-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const verified = verifyPayOsWebhook(body);
  if (!verified.ok) {
    return NextResponse.json({ success: false, message: verified.reason }, { status: 401 });
  }

  const data = verified.data || {};
  const providerOrderId = String(data.orderCode || "");
  const order = providerOrderId ? await findOrderByPaymentProviderOrderId(providerOrderId) : null;
  if (!order) {
    return NextResponse.json({ success: true, message: "Webhook verified; order not found or validation ping." });
  }

  const amount = Number(data.amount || 0);
  const successful = body.success === true && String(data.code || "") === "00";
  if (!successful || amount !== order.total || order.paymentMethod !== "bank_transfer") {
    return NextResponse.json({ success: false, message: "Payment data does not match the order." }, { status: 400 });
  }

  await confirmVerifiedPayment(order.code, {
    transactionId: String(data.reference || ""),
    paymentProviderOrderId: providerOrderId,
    paymentLinkId: String(data.paymentLinkId || ""),
    providerMessage: "payOS webhook verified"
  });
  return NextResponse.json({ success: true });
}
