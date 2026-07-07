import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrderStatus } from "@/lib/orders";
import { verifyZaloPayBody } from "@/lib/payment";

export async function POST(request: Request) {
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
  const orderCode = appTransId.split("_").slice(1).join("_");
  const amount = Number(data.amount ?? 0);
  const order = await findOrderByCode(orderCode);

  if (!order) return NextResponse.json({ return_code: 0, return_message: "Order not found" });
  if (order.total !== amount) return NextResponse.json({ return_code: 0, return_message: "Invalid amount" });

  await updateOrderStatus(orderCode, "paid", {
    transactionId: data.zp_trans_id ? String(data.zp_trans_id) : undefined,
    providerOrderId: appTransId,
    providerMessage: "ZaloPay payment success"
  });

  return NextResponse.json({ return_code: 1, return_message: "success" });
}
