import { after, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-errors";
import { readIntegrationConfig } from "@/lib/integrations";
import { createOrder, findOrderByCheckoutRequestId, newOrderCode, updateOrder } from "@/lib/orders";
import { createMomoPayment, createVnpayUrl, createZaloPayPayment, fallbackPaymentUrl } from "@/lib/payment";
import { CartItem, PaymentMethod, ShopOrder } from "@/lib/types";
import { InventoryService } from "@/lib/pancake/inventory-service";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent, type SiteContent } from "@/lib/site-content";
import { POSSyncService } from "@/lib/services/pos-sync-service";
import { QueueHandler } from "@/lib/pancake/queue-handler";

type CheckoutPayload = {
  customerDeviceId?: string;
  checkoutRequestId?: string;
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
const enabledCheckoutMethods = new Set<PaymentMethod>(["cod", "zalopay"]);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

async function queuePosSync(order: ShopOrder) {
  try {
    await QueueHandler.enqueue("order.create", { orderCode: order.code });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không ghi được hàng đợi Pancake.";
    await updateOrder(order.code, {
      externalSync: {
        ...order.externalSync,
        pancake: `Đã lưu đơn, chờ gửi Pancake: ${message}`,
        lastSyncedAt: new Date().toISOString()
      }
    });
    return false;
  }
}

function schedulePosSync(order: ShopOrder) {
  after(async () => {
    try {
      await new POSSyncService().confirmOrder(order);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể đồng bộ đơn sang Pancake.";
      await updateOrder(order.code, {
        externalSync: {
          ...order.externalSync,
          pancake: `Lỗi đồng bộ: ${message}`,
          lastSyncedAt: new Date().toISOString()
        }
      });
      // The database order is already safe. Queue a retry only when the direct
      // Pancake request fails, so a slow R2 queue never delays a successful sync.
      await queuePosSync(order);
    }
  });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...init?.headers
    }
  });
}

function phoneDigitCount(value: unknown) {
  return String(value || "").replace(/\D/g, "").length;
}

function demoPaymentsAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_PAYMENTS === "true";
}

function hasText(value?: string) {
  return Boolean(value?.trim());
}

function paymentConfigError(method: PaymentMethod, paymentConfig: Awaited<ReturnType<typeof readIntegrationConfig>>["payment"]) {
  const hasVnpay = Boolean((hasText(paymentConfig.vnpay.tmnCode) && hasText(paymentConfig.vnpay.hashSecret)) || (hasText(process.env.VNPAY_TMN_CODE) && hasText(process.env.VNPAY_HASH_SECRET)));
  const hasMomo = Boolean((hasText(paymentConfig.momo.partnerCode) && hasText(paymentConfig.momo.accessKey) && hasText(paymentConfig.momo.secretKey)) || (hasText(process.env.MOMO_PARTNER_CODE) && hasText(process.env.MOMO_ACCESS_KEY) && hasText(process.env.MOMO_SECRET_KEY)));
  const hasZaloPay = Boolean((hasText(paymentConfig.zalopay.appId) && hasText(paymentConfig.zalopay.key1) && hasText(paymentConfig.zalopay.key2)) || (hasText(process.env.ZALOPAY_APP_ID) && hasText(process.env.ZALOPAY_KEY1) && hasText(process.env.ZALOPAY_KEY2)));
  if (method !== "zalopay" && demoPaymentsAllowed()) return "";
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
    const normalizedQuantity = Math.max(1, Math.min(100, Math.floor(Number(isCartItem(item) ? item.quantity : item.qty) || 1)));
    if (isCartItem(item)) {
      return {
        productId: item.product.id,
        name: item.product.name,
        color: item.color.name,
        size: item.size,
        quantity: normalizedQuantity,
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
      classificationId: item.classificationId || "",
      classificationName: item.classificationName || "",
      quantity: normalizedQuantity,
      unitPrice: Number(item.price || 0)
    };
  });
}

function parseMoneyValue(value: unknown) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
}

function productUnitPrice(product: SiteContent["products"][number]) {
  const value = Math.max(0, Math.floor(parseMoneyValue(product.price)));
  if (value <= 0) throw new Error(`${product.name} chưa có giá bán hợp lệ. Vui lòng tải lại trang hoặc báo shop kiểm tra giá sản phẩm.`);
  return value;
}

function normalizedText(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

async function hydratePancakeLinks(items: ReturnType<typeof normalizeItems>, content: Awaited<ReturnType<typeof readSiteContent>>) {
  return items.map((item) => {
    const product = content.products.find((candidate) => candidate.id === item.productId);
    if (!product || product.active === false) {
      throw new Error(`${item.name || "Sản phẩm"} không còn bán trên website. Vui lòng tải lại trang và đặt lại.`);
    }
    const rows = buildProductInventory(product);
    const colorNameFor = (row: (typeof rows)[number]) => {
      const classification = product.classifications?.find((entry) => entry.id === row.classificationId);
      return classification?.colorNames?.[row.color || ""] || product.colorNames?.[row.color || ""] || row.color || "";
    };
    const row = rows.find((candidate) =>
      (item.inventoryKey && candidate.key === item.inventoryKey)
      || (item.pancakeVariationId && candidate.pancakeVariationId === item.pancakeVariationId)
      || (item.pancakeSku && (candidate.pancakeSku || "").toUpperCase() === item.pancakeSku.toUpperCase())
      || (item.sku && candidate.sku.toUpperCase() === item.sku.toUpperCase())
      || (
        item.classificationId === (candidate.classificationId || "")
        && normalizedText(item.size) === normalizedText(candidate.size)
        && normalizedText(item.color) === normalizedText(colorNameFor(candidate))
      )
    );
    const authoritativeItem = {
      ...item,
      name: item.name.includes(" - ") ? `${product.name} - ${item.name.split(" - ").slice(1).join(" - ")}` : product.name,
      unitPrice: productUnitPrice(product)
    };
    return row ? {
      ...authoritativeItem,
      inventoryKey: row.key,
      sku: row.sku,
      pancakeSku: row.pancakeSku,
      pancakeProductId: row.pancakeProductId,
      pancakeVariationId: row.pancakeVariationId
    } : authoritativeItem;
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
    const customerDeviceId = String(payload.customerDeviceId || "").trim().slice(0, 100);
    const checkoutRequestId = String(payload.checkoutRequestId || "").trim().slice(0, 120);
    // COD must not wait for merchant configuration stored outside Postgres.
    // Only online payment methods need those credentials.
    const [integrations, siteContent] = await Promise.all([
      onlineMethods.has(paymentMethod) ? readIntegrationConfig() : Promise.resolve(null),
      readSiteContent()
    ]);
    const now = new Date().toISOString();
    const inventoryService = new InventoryService();
    const pancakeConfigured = inventoryService.configured();

    if (!enabledCheckoutMethods.has(paymentMethod)) {
      return json({ error: "Phương thức thanh toán này không còn được hỗ trợ. Vui lòng chọn COD hoặc Zalopay." }, { status: 400 });
    }

    if (!customer.name || !customer.phone || !customer.address) {
      return json({ error: "Vui lòng nhập đủ họ tên, số điện thoại và địa chỉ." }, { status: 400 });
    }
    if (phoneDigitCount(customer.phone) < 10) {
      return json({ error: "Số điện thoại bạn nhập chưa đủ số. Vui lòng nhập đủ số điện thoại để thanh toán bình thường." }, { status: 400 });
    }
    if (!customer.provinceId || !customer.districtId || !customer.wardId || !customer.house) {
      return json({ error: "Vui lòng chọn đủ Tỉnh/Thành, Quận/Huyện, Phường/Xã và nhập số nhà để đồng bộ địa chỉ sang POS." }, { status: 400 });
    }
    if (!items.length) {
      return json({ error: "Giỏ hàng đang trống." }, { status: 400 });
    }
    if (onlineMethods.has(paymentMethod)) {
      const configError = paymentConfigError(paymentMethod, integrations!.payment);
      if (configError) return json({ error: configError }, { status: 400 });
    }

    if (checkoutRequestId) {
      const existing = await findOrderByCheckoutRequestId(checkoutRequestId, customerDeviceId);
      if (existing) {
        if (paymentMethod === "cod" && existing.status === "pending") {
          const completed = existing.checkoutCompletedAt ? existing : await updateOrder(existing.code, {
            checkoutCompletedAt: now,
            ...(pancakeConfigured ? { externalSync: {
              ...existing.externalSync,
              pancake: "Đang đồng bộ Pancake",
              lastSyncedAt: now
            } } : {})
          }) || existing;
          const accepted = await inventoryService.reserveOrder(completed);
          let syncQueued = false;
          if (pancakeConfigured) {
            schedulePosSync(accepted);
            syncQueued = true;
          }
          return json({ order: accepted, syncQueued, deduplicated: true });
        }
        if (paymentMethod === "zalopay" && existing.status === "pending") {
          const zalopay = await createZaloPayPayment(existing, request, integrations!.payment);
          if (zalopay.order_url) {
            const refreshed = await updateOrder(existing.code, {
              paymentProviderOrderId: zalopay.app_trans_id,
              providerMessage: "ZaloPay payment link recreated for idempotent checkout"
            }) || existing;
            return json({ order: refreshed, redirectUrl: zalopay.order_url, token: zalopay.zp_trans_token || zalopay.order_token, deduplicated: true });
          }
        }
        return json({ order: existing, deduplicated: true });
      }
    }

    const defaultShippingFee = Math.max(0, Math.floor(Number(siteContent.shipping?.defaultFee ?? 30000) || 0));
    const isExpressShipping = payload.shipping?.type === "express";
    if (isExpressShipping && siteContent.shipping?.expressEnabled !== true) {
      return json({ error: "Giao hỏa tốc hiện đang tắt. Vui lòng chọn giao tiêu chuẩn." }, { status: 400 });
    }
    const standardShippingFor = (subtotal: number) => subtotal === 0 || subtotal >= 2000000 ? 0 : defaultShippingFee;
    const orderItems = await hydratePancakeLinks(normalizeItems(items), siteContent);
    const subtotal = orderItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
    const discount = Math.max(0, Math.min(subtotal, Math.floor(Number(payload.totals?.discount) || 0)));
    const shipping = isExpressShipping ? 0 : standardShippingFor(subtotal);
    const totals = {
      subtotal,
      discount,
      shipping,
      total: Math.max(subtotal - discount + shipping, 0)
    };
    await inventoryService.assertAvailable(orderItems);
    let order: ShopOrder = {
      id: crypto.randomUUID(),
      code: newOrderCode(),
      customerDeviceId: customerDeviceId || undefined,
      customerDeviceBoundAt: customerDeviceId ? now : undefined,
      checkoutRequestId: checkoutRequestId || undefined,
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
      shippingMethod: payload.shipping?.method || "Giao tiêu chuẩn",
      shippingFeeLabel: payload.shipping?.feeLabel,
      shippingCarrier: payload.shipping?.type === "express" ? "" : "SPX Express",
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

    if (paymentMethod === "zalopay") {
      const pendingZaloPayOrder: ShopOrder = {
        ...order,
        externalSync: pancakeConfigured
          ? { ...order.externalSync, pancake: "Chờ ZaloPay xác nhận - chưa gửi Pancake", lastSyncedAt: now }
          : order.externalSync
      };
      const zalopay = await createZaloPayPayment(pendingZaloPayOrder, request, integrations!.payment);
      if (!zalopay.order_url) {
        return json({
          error: zalopay.return_message || "ZaloPay chưa trả link thanh toán. Vui lòng kiểm tra App ID, Key 1, Key 2 production trong trang admin."
        }, { status: 400 });
      }
      const saved = await createOrder({
        ...pendingZaloPayOrder,
        paymentProviderOrderId: zalopay.app_trans_id,
        providerMessage: "ZaloPay payment link created",
        checkoutCompletedAt: now
      });
      return json({
        order: saved,
        redirectUrl: zalopay.order_url,
        token: zalopay.zp_trans_token || zalopay.order_token,
        demo: "demo" in zalopay ? zalopay.demo : false,
        message: zalopay.return_message
      });
    }

    if (pancakeConfigured && paymentMethod === "cod") {
      order.externalSync = {
        ...order.externalSync,
        pancake: "Đang đồng bộ Pancake",
        lastSyncedAt: now
      };
    }
    order = await inventoryService.createReservedOrder({ ...order, checkoutCompletedAt: now });
    if (pancakeConfigured && paymentMethod === "cod") {
      schedulePosSync(order);
      return json({ order, syncQueued: true });
    }

    if (paymentMethod === "vnpay") {
      return json({ order, redirectUrl: createVnpayUrl(order, request, integrations!.payment) });
    }

    if (paymentMethod === "momo") {
      const momo = await createMomoPayment(order, request, integrations!.payment);
      return json({
        order,
        redirectUrl: momo.payUrl || fallbackPaymentUrl(order, paymentMethod, request),
        qrCodeUrl: momo.qrCodeUrl,
        deeplink: momo.deeplink,
        demo: "demo" in momo ? momo.demo : false
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
