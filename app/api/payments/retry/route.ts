import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { findOrderByCode, updateOrder } from "@/lib/orders";
import { createMomoPayment, createVnpayUrl, createZaloPayPayment, fallbackPaymentUrl } from "@/lib/payment";
import type { PaymentMethod } from "@/lib/types";
import { reconcileZaloPayPayment } from "@/lib/payment-confirmation";

const payableMethods = new Set<PaymentMethod>(["bank_transfer", "vnpay", "momo", "zalopay", "onepay", "alepay"]);

function phoneKey(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { code?: string; phone?: string };
    const code = String(body.code || "").trim();
    let order = code ? await findOrderByCode(code) : null;
    if (!order) return NextResponse.json({ error: "Không tìm thấy đơn hàng." }, { status: 404 });
    if (!phoneKey(body.phone) || phoneKey(body.phone) !== phoneKey(order.customer.phone)) {
      return NextResponse.json({ error: "Số điện thoại không khớp với đơn hàng." }, { status: 403 });
    }
    if (order.status === "pending" && order.paymentMethod === "zalopay") {
      const config = await readIntegrationConfig();
      order = await reconcileZaloPayPayment(order, config.payment);
    }
    if (order.status === "paid") {
      return NextResponse.json({ error: "Đơn này đã thanh toán rồi." }, { status: 409 });
    }
    if (order.status === "cancelled" || order.status === "failed") {
      return NextResponse.json({ error: "Đơn này không còn thanh toán được." }, { status: 409 });
    }
    if (!payableMethods.has(order.paymentMethod)) {
      return NextResponse.json({ error: "Đơn COD sẽ thanh toán khi nhận hàng, không cần thanh toán online." }, { status: 400 });
    }

    const integrations = await readIntegrationConfig();
    if (order.paymentMethod === "bank_transfer") {
      return NextResponse.json({ redirectUrl: fallbackPaymentUrl(order, order.paymentMethod, request) });
    }
    if (order.paymentMethod === "vnpay") {
      return NextResponse.json({ redirectUrl: createVnpayUrl(order, request, integrations.payment) });
    }
    if (order.paymentMethod === "momo") {
      const momo = await createMomoPayment(order, request, integrations.payment);
      return NextResponse.json({
        redirectUrl: momo.payUrl || fallbackPaymentUrl(order, order.paymentMethod, request),
        qrCodeUrl: momo.qrCodeUrl,
        deeplink: momo.deeplink
      });
    }
    if (order.paymentMethod === "zalopay") {
      const zalopay = await createZaloPayPayment(order, request, integrations.payment);
      if (!zalopay.order_url) {
        return NextResponse.json({ error: zalopay.return_message || "ZaloPay chưa trả link thanh toán." }, { status: 400 });
      }
      await updateOrder(order.code, {
        paymentProviderOrderId: zalopay.app_trans_id,
        providerMessage: "ZaloPay payment link created"
      });
      return NextResponse.json({
        redirectUrl: zalopay.order_url,
        token: zalopay.zp_trans_token || zalopay.order_token
      });
    }

    return NextResponse.json({ redirectUrl: fallbackPaymentUrl(order, order.paymentMethod, request) });
  } catch (error) {
    return jsonError(error);
  }
}
