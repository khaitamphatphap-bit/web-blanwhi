import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { OrderService } from "@/lib/services/order-service";

type Params = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { action?: "create" | "track" | "cancel"; reason?: string };
    const service = new OrderService();
    const action = body.action || "create";
    const order = action === "track"
      ? await service.trackExpressDelivery(code)
      : action === "cancel"
        ? await service.cancelExpressDelivery(code, body.reason)
        : await service.createExpressDelivery(code);
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return jsonError(error);
  }
}
