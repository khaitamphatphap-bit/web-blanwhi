import { NextResponse } from "next/server";
import { reconcileAdminOrders } from "@/lib/admin-orders";
import { jsonError } from "@/lib/api-errors";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { codes?: string[] };
    const codes = Array.isArray(body.codes) ? body.codes : [];
    if (!codes.length) return NextResponse.json({ orders: [] });
    const orders = await reconcileAdminOrders(codes);
    return NextResponse.json({ orders }, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (error) {
    return jsonError(error);
  }
}
