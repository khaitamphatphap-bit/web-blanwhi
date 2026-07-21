import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrderStatus } from "@/lib/orders";
import { confirmVerifiedPayment } from "@/lib/services/payment-confirmation-service";
import { verifyMomoBody } from "@/lib/payment";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const integrations = await readIntegrationConfig();
    const verified = verifyMomoBody(body, integrations.payment);
    if (!verified.ok) {
      return NextResponse.json({ resultCode: 97, message: verified.reason });
    }

    const orderCode = String(body.orderId ?? "");
    const amount = Number(body.amount ?? 0);
    const resultCode = Number(body.resultCode ?? -1);
    const order = await findOrderByCode(orderCode);

    if (!order) return NextResponse.json({ resultCode: 1, message: "Order not found" });
    if (order.total !== amount) return NextResponse.json({ resultCode: 4, message: "Invalid amount" });

    if (resultCode === 0) {
      await confirmVerifiedPayment(orderCode, {
        transactionId: body.transId ? String(body.transId) : undefined,
        paymentProviderOrderId: body.requestId ? String(body.requestId) : undefined,
        providerMessage: body.message ? String(body.message) : "MoMo payment success"
      });
    } else {
      await updateOrderStatus(orderCode, "failed", { providerMessage: body.message ? String(body.message) : `MoMo result ${resultCode}` });
    }

    return NextResponse.json({ resultCode: 0, message: "Confirm Success" });
  } catch (error) {
    const response = jsonError(error);
    const body = await response.json();
    return NextResponse.json({ resultCode: 99, message: body.error }, { status: response.status });
  }
}
