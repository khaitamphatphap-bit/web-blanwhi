import { NextResponse } from "next/server";
import { integrationHeaders, readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";

type Params = { params: Promise<{ code: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { target?: "misa" | "pancake" | "all" };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    const target = body.target || "all";
    const result: Record<string, string> = {};
    if (target === "all" || target === "pancake") {
      const synced = await new OrderSyncService().create(order);
      result.pancake = synced?.externalSync?.pancake || "Đã gửi Pancake";
    }
    if (target === "all" || target === "misa") {
      const config = await readIntegrationConfig();
      if (config.misa.enabled && config.misa.endpoint) {
        const response = await fetch(config.misa.endpoint, { method: "POST", headers: integrationHeaders(config.misa.token), body: JSON.stringify(order) });
        result.misa = response.ok ? `Đã gửi (${response.status})` : `Lỗi ${response.status}`;
      }
    }
    const updated = await updateOrder(code, { externalSync: { ...order.externalSync, ...result, lastSyncedAt: new Date().toISOString() } });
    return NextResponse.json({ order: updated, result });
  } catch (error) {
    const normalized = ExceptionHandler.normalize(error);
    return NextResponse.json({ error: normalized.message, code: normalized.code }, { status: normalized.status });
  }
}
