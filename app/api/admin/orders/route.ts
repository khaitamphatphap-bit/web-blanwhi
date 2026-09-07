import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readAdminOrders } from "@/lib/admin-orders";
import { readPaymentOrphans } from "@/lib/payment-orphans";

export async function GET() {
  try {
    const [orders, paymentOrphans] = await Promise.all([
      readAdminOrders(),
      readPaymentOrphans()
    ]);
    return NextResponse.json({ orders, paymentOrphans }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
