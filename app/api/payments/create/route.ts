import { NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { createOrder, newOrderCode } from "@/lib/orders";
import { checkoutTotals } from "@/lib/pricing";
import { createMomoPayment, createVnpayUrl, createZaloPayPayment, fallbackPaymentUrl } from "@/lib/payment";
import { CartItem, PaymentMethod, ShopOrder } from "@/lib/types";

type CheckoutPayload = {
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    note?: string;
  };
  paymentMethod?: PaymentMethod;
  items?: Array<CartItem | PreviewCheckoutItem>;
  totals?: {
    subtotal?: number;
    discount?: number;
    shipping?: number;
    total?: number;
  };
  shipping?: {
    method?: string;
    feeLabel?: string;
    carrier?: string;
    trackingCode?: string;
  };
};

type PreviewCheckoutItem = {
  name: string;
  qty: number;
  price: number;
  color?: string;
  size?: string;
  message?: string;
  designName?: string;
  customText?: string;
};

const onlineMethods = new Set<PaymentMethod>(["vnpay", "onepay", "alepay", "momo", "zalopay"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers
    }
  });
}

function demoPaymentsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_PAYMENTS === "true";
}

function paymentConfigError(method: PaymentMethod, paymentConfig: Awaited<ReturnType<typeof readIntegrationConfig>>["payment"]) {
  if (demoPaymentsAllowed()) return "";
  const hasVnpay = (paymentConfig.vnpay.enabled && paymentConfig.vnpay.tmnCode && paymentConfig.vnpay.hashSecret) || (process.env.VNPAY_TMN_CODE && process.env.VNPAY_HASH_SECRET);
  const hasMomo = (paymentConfig.momo.enabled && paymentConfig.momo.partnerCode && paymentConfig.momo.accessKey && paymentConfig.momo.secretKey) || (process.env.MOMO_PARTNER_CODE && process.env.MOMO_ACCESS_KEY && process.env.MOMO_SECRET_KEY);
  const hasZaloPay = (paymentConfig.zalopay.enabled && paymentConfig.zalopay.appId && paymentConfig.zalopay.key1 && paymentConfig.zalopay.key2) || (process.env.ZALOPAY_APP_ID && process.env.ZALOPAY_KEY1 && process.env.ZALOPAY_KEY2);
  if (method === "vnpay" && !hasVnpay) {
    return "Website chưa cấu hình merchant VNPAY thật.";
  }
  if (method === "momo" && !hasMomo) {
    return "Website chưa cấu hình merchant MoMo thật.";
  }
  if (method === "zalopay" && !hasZaloPay) {
    return "Website chưa cấu hình merchant ZaloPay thật.";
  }
  if (method === "onepay" || method === "alepay") {
    return "OnePay/AlePay cần endpoint merchant thật trước khi nhận thanh toán production.";
  }
  return "";
}

function isCartItem(item: CartItem | PreviewCheckoutItem): item is CartItem {
  return "product" in item;
}

function normalizeItems(items: Array<CartItem | PreviewCheckoutItem>) {
  return items.map((item, index) => {
    if (isCartItem(item)) {
      return {
        productId: item.product.id,
        name: item.product.name,
        color: item.color.name,
        size: item.size,
        quantity: item.quantity,
        unitPrice: item.product.price
      };
    }

    return {
      productId: `preview-${index + 1}`,
      name: item.name,
      color: item.color || item.designName || "",
      size: item.size || "",
      quantity: Number(item.qty || 1),
      unitPrice: Number(item.price || 0)
    };
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as CheckoutPayload;
  const items = payload.items ?? [];
  const paymentMethod = payload.paymentMethod ?? "cod";
  const customer = payload.customer ?? {};
  const integrations = await readIntegrationConfig();

  if (!customer.name || !customer.phone || !customer.address) {
    return json({ error: "Vui lòng nhập đủ họ tên, số điện thoại và địa chỉ." }, { status: 400 });
  }
  if (!items.length) {
    return json({ error: "Giỏ hàng đang trống." }, { status: 400 });
  }
  if (onlineMethods.has(paymentMethod)) {
    const configError = paymentConfigError(paymentMethod, integrations.payment);
    if (configError) return json({ error: configError }, { status: 400 });
  }

  const reactItems = items.filter(isCartItem);
  const computedTotals = reactItems.length === items.length ? checkoutTotals(reactItems) : {
    subtotal: items.reduce((sum, item) => {
      if (isCartItem(item)) return sum + item.product.price * item.quantity;
      return sum + Number(item.price || 0) * Number(item.qty || 1);
    }, 0),
    discount: 0,
    shipping: 0,
    total: items.reduce((sum, item) => {
      if (isCartItem(item)) return sum + item.product.price * item.quantity;
      return sum + Number(item.price || 0) * Number(item.qty || 1);
    }, 0)
  };
  const totals = {
    subtotal: payload.totals?.subtotal ?? computedTotals.subtotal,
    discount: payload.totals?.discount ?? computedTotals.discount,
    shipping: payload.totals?.shipping ?? computedTotals.shipping,
    total: payload.totals?.total ?? computedTotals.total
  };
  const orderItems = normalizeItems(items);
  const now = new Date().toISOString();
  const order: ShopOrder = {
    id: crypto.randomUUID(),
    code: newOrderCode(),
    status: "pending",
    paymentMethod,
    paymentProvider: paymentMethod,
    customer: {
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      note: customer.note
    },
    items: orderItems,
    subtotal: totals.subtotal,
    discount: totals.discount,
    shipping: totals.shipping,
    shippingMethod: payload.shipping?.method || "Giao nhanh",
    shippingFeeLabel: payload.shipping?.feeLabel,
    shippingCarrier: payload.shipping?.carrier || "GHN",
    trackingCode: payload.shipping?.trackingCode || `VN${Date.now().toString().slice(-10)}`,
    shippingStatus: "not_created",
    total: totals.total,
    createdAt: now,
    updatedAt: now
  };

  await createOrder(order);

  if (paymentMethod === "vnpay") {
    return json({ order, redirectUrl: createVnpayUrl(order, request, integrations.payment) });
  }

  if (paymentMethod === "momo") {
    const momo = await createMomoPayment(order, request, integrations.payment);
    return json({
      order,
      redirectUrl: momo.payUrl || fallbackPaymentUrl(order, paymentMethod, request),
      qrCodeUrl: momo.qrCodeUrl,
      deeplink: momo.deeplink,
      demo: "demo" in momo ? momo.demo : false
    });
  }

  if (paymentMethod === "zalopay") {
    const zalopay = await createZaloPayPayment(order, request, integrations.payment);
    return json({
      order,
      redirectUrl: zalopay.order_url || fallbackPaymentUrl(order, paymentMethod, request),
      token: zalopay.zp_trans_token || zalopay.order_token,
      demo: "demo" in zalopay ? zalopay.demo : false,
      message: zalopay.return_message
    });
  }

  if (paymentMethod === "onepay" || paymentMethod === "alepay") {
    if (!demoPaymentsAllowed()) {
      return json({ error: "OnePay/AlePay chưa có cấu hình merchant thật." }, { status: 400 });
    }
    return json({
      order,
      redirectUrl: fallbackPaymentUrl(order, paymentMethod, request),
      demo: true,
      message: "OnePay/AlePay cần merchant endpoint riêng. Luồng demo đã tạo đơn pending và chuyển sang trang kết quả."
    });
  }

  return json({
    order,
    redirectUrl: fallbackPaymentUrl(order, paymentMethod, request)
  });
}
