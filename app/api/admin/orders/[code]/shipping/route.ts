import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { fetchShippingStatus } from "@/lib/shipping-providers";

type Params = { params: Promise<{ code: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { code } = await params;
  const order = await findOrderByCode(code);
  if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });

  const config = await readIntegrationConfig();
  if (!config.shipping.enabled) {
    return NextResponse.json({ error: "Chưa bật cập nhật API vận chuyển." }, { status: 400 });
  }
  if (!order.trackingCode) {
    return NextResponse.json({ error: "Đơn chưa có mã vận đơn." }, { status: 400 });
  }

  try {
    const result = await fetchShippingStatus(config.shipping, order);
    const updated = await updateOrder(order.code, {
      shippingCarrier: result.carrier,
      trackingCode: result.trackingCode,
      shippingStatus: result.status,
      shippingMessage: result.message,
      externalSync: {
        ...order.externalSync,
        shipping: `${result.carrier}: ${result.message || result.status} (${new Date().toLocaleString("vi-VN")})`,
        lastSyncedAt: new Date().toISOString()
      }
    });

    return NextResponse.json({ order: updated, payload: result.payload });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Dung lượng")) return jsonError(error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Không cập nhật được vận chuyển."
    }, { status: 502 });
  }
}
