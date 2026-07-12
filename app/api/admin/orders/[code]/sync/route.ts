import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { integrationHeaders, readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";

type Params = { params: Promise<{ code: string }> };

function externalPayload(order: NonNullable<Awaited<ReturnType<typeof findOrderByCode>>>, target: string) {
  return {
    target,
    source: "BLANWHI",
    orderCode: order.code,
    status: order.status,
    customer: order.customer,
    items: order.items,
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    total: order.total,
    paymentMethod: order.paymentMethod,
    shippingCarrier: order.shippingCarrier,
    trackingCode: order.trackingCode,
    createdAt: order.createdAt
  };
}

async function postOrder(endpoint: string, token: string, payload: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: integrationHeaders(token),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    message: text.slice(0, 500)
  };
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { code } = await params;
    const body = await request.json().catch(() => ({})) as { target?: "misa" | "pancake" | "all" };
    const order = await findOrderByCode(code);
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });

    const config = await readIntegrationConfig();
    const target = body.target || "all";
    const result: Record<string, string> = {};

    if ((target === "all" || target === "pancake") && config.pancake.enabled && config.pancake.endpoint) {
      const response = await postOrder(config.pancake.endpoint, config.pancake.token, externalPayload(order, "pancake"));
      result.pancake = response.ok ? `Đã gửi (${response.status})` : `Lỗi ${response.status}: ${response.message}`;
    }

    if ((target === "all" || target === "misa") && config.misa.enabled && config.misa.endpoint) {
      const response = await postOrder(config.misa.endpoint, config.misa.token, externalPayload(order, "misa"));
      result.misa = response.ok ? `Đã gửi (${response.status})` : `Lỗi ${response.status}: ${response.message}`;
    }

    if (!Object.keys(result).length) {
      return NextResponse.json({ error: "Chưa bật hoặc chưa nhập endpoint tích hợp." }, { status: 400 });
    }

    const updated = await updateOrder(code, {
      externalSync: {
        ...order.externalSync,
        ...result,
        lastSyncedAt: new Date().toISOString()
      }
    });

    return NextResponse.json({ order: updated, result });
  } catch (error) {
    return jsonError(error);
  }
}
