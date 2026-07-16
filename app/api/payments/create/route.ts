import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { createOrder, newOrderCode, updateOrder } from "@/lib/orders";
import { checkoutTotals } from "@/lib/pricing";
import { createMomoPayment, createVnpayUrl, createZaloPayPayment, fallbackPaymentUrl } from "@/lib/payment";
import { CartItem, PaymentMethod, ShopOrder } from "@/lib/types";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { POSSyncService } from "@/lib/services/pos-sync-service";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent } from "@/lib/site-content";

type CheckoutPayload = {
  customer?: {
    name?: string;
    phone?: string;
    address?: string;
    house?: string;
    ward?: string;
    province?: string;
    provinceId?: string;
    district?: string;
    districtId?: string;
    wardId?: string;
    note?: string;
    email?: string;
    latitude?: string;
    longitude?: string;
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
    type?: "standard" | "express";
    provider?: "ahamove" | "lalamove";
    quotationId?: string;
    estimatedFee?: number;
  };
};

type PreviewCheckoutItem = {
  productId?: string;
  inventoryKey?: string;
  sku?: string;
  pancakeSku?: string;
  pancakeProductId?: string;
  pancakeVariationId?: string;
  classificationId?: string;
  name: string;
  qty: number;
  price: number;
  color?: string;
  size?: string;
  message?: string;
  designName?: string;
  classificationName?: string;
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
      productId: item.productId || `preview-${index + 1}`,
      inventoryKey: item.inventoryKey,
      sku: item.sku,
      pancakeSku: item.pancakeSku,
      pancakeProductId: item.pancakeProductId,
      pancakeVariationId: item.pancakeVariationId,
      name: item.classificationName ? `${item.name} - ${item.classificationName}` : item.name,
      color: item.color || item.designName || "",
      size: item.size || "",
      quantity: Number(item.qty || 1),
      unitPrice: Number(item.price || 0)
    };
  });
}

async function hydratePancakeLinks(items: ReturnType<typeof normalizeItems>) {
  const content = await readSiteContent();
  return items.map((item) => {
    const product = content.products.find((candidate) => candidate.id === item.productId);
    if (!product) return item;
    const rows = buildProductInventory(product);
    const row = rows.find((candidate) =>
      (item.inventoryKey && candidate.key === item.inventoryKey)
      || (item.sku && candidate.sku.toUpperCase() === item.sku.toUpperCase())
    );
    return row ? {
      ...item,
      inventoryKey: row.key,
      sku: row.sku,
      pancakeSku: row.pancakeSku,
      pancakeProductId: row.pancakeProductId,
      pancakeVariationId: row.pancakeVariationId
    } : item;
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CheckoutPayload;
    const items = payload.items ?? [];
    const paymentMethod = payload.paymentMethod ?? "cod";
    const customer = payload.customer ?? {};
    const integrations = await readIntegrationConfig();

    if (!customer.name || !customer.phone || !customer.address) {
      return json({ error: "Vui lòng nhập đủ họ tên, số điện thoại và địa chỉ." }, { status: 400 });
    }
    if (!customer.provinceId || !customer.districtId || !customer.wardId || !customer.house) {
      return json({ error: "Vui lòng chọn đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã và nhập số nhà để đồng bộ địa chỉ sang POS." }, { status: 400 });
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
    const orderItems = await hydratePancakeLinks(normalizeItems(items));
    const inventoryService = new InventoryService();
    const pancakeConfigured = inventoryService.configured();
    if (pancakeConfigured) await inventoryService.assertAvailable(orderItems);
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
        email: customer.email,
        address: customer.address,
        house: customer.house,
        ward: customer.ward,
        province: customer.province,
        provinceId: customer.provinceId,
        district: customer.district,
        districtId: customer.districtId,
        wardId: customer.wardId,
        note: customer.note,
        latitude: customer.latitude,
        longitude: customer.longitude
      },
      items: orderItems,
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      shippingMethod: payload.shipping?.method || "Viettel Post",
      shippingFeeLabel: payload.shipping?.feeLabel,
      shippingCarrier: payload.shipping?.type === "express" ? "" : "Viettel Post",
      trackingCode: "",
      shippingStatus: payload.shipping?.type === "express" ? "awaiting_creation" : "not_created",
      shippingMessage: payload.shipping?.type === "express" ? "Chờ tạo vận đơn hỏa tốc" : "",
      deliveryType: payload.shipping?.type || "standard",
      deliveryProvider: payload.shipping?.provider,
      deliveryQuotationId: payload.shipping?.quotationId,
      deliveryFeeEstimated: payload.shipping?.estimatedFee ?? totals.shipping,
      total: totals.total,
      createdAt: now,
      updatedAt: now
    };

    await createOrder(order);
    if (pancakeConfigured) {
      order.externalSync = { ...order.externalSync, pancake: "Đang gửi Pancake" };
      after(async () => {
        try {
          await new POSSyncService().confirmOrder(order);
        } catch {
          await updateOrder(order.code, {
            externalSync: { ...order.externalSync, pancake: "Đang chờ hệ thống gửi lại Pancake", lastSyncedAt: new Date().toISOString() }
          });
        }
      });
    }

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
  } catch (error) {
    const response = jsonError(error);
    const body = await response.json();
    return json(body, { status: response.status });
  }
}
