import { NextResponse } from "next/server";
import { createOrder, findOrderByCode } from "@/lib/orders";
import { OrderSyncService } from "@/lib/pancake/order-sync-service";
import { buildProductInventory } from "@/lib/product-inventory";
import { readSiteContent } from "@/lib/site-content";
import type { PaymentMethod, ShopOrder } from "@/lib/types";

type LocalItem = {
  productId?: string;
  inventoryKey?: string;
  sku?: string;
  name?: string;
  color?: string;
  size?: string;
  classificationName?: string;
  qty?: number;
  price?: number;
};

type LocalOrder = {
  code?: string;
  trackingCode?: string;
  paymentMethod?: PaymentMethod;
  customer?: { name?: string; phone?: string; address?: string; email?: string };
  items?: LocalItem[];
  note?: string;
  shippingMethod?: string;
  shippingFee?: number | string;
  total?: number;
};

const paymentMethods = new Set<PaymentMethod>(["cod", "bank_transfer", "vnpay", "onepay", "alepay", "momo", "zalopay"]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as LocalOrder;
  const code = String(body.code || "").trim().toUpperCase();
  if (!/^BLW-\d{14}-[A-Z0-9]{5}$/.test(code)) return NextResponse.json({ error: "Mã đơn cũ không hợp lệ." }, { status: 400 });
  const existing = await findOrderByCode(code);
  if (existing) return NextResponse.json({ ok: true, order: existing, recovered: false });

  const customer = body.customer || {};
  if (!customer.name?.trim() || !customer.phone?.trim() || !customer.address?.trim()) {
    return NextResponse.json({ error: "Đơn cũ thiếu thông tin khách hàng." }, { status: 400 });
  }
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) {
    return NextResponse.json({ error: "Đơn cũ không có sản phẩm hợp lệ." }, { status: 400 });
  }

  const content = await readSiteContent();
  let items: ShopOrder["items"];
  try {
    items = body.items.map((item) => {
      const product = content.products.find((candidate) => candidate.id === item.productId);
      const row = product && buildProductInventory(product).find((candidate) =>
        (item.inventoryKey && candidate.key === item.inventoryKey)
        || (item.sku && candidate.sku.toUpperCase() === item.sku.toUpperCase())
      );
      if (!product || !row || !(row.pancakeVariationId || row.pancakeProductId || row.pancakeSku)) {
        throw new Error(`${item.name || "Sản phẩm"} chưa liên kết đúng biến thể Pancake.`);
      }
      return {
        productId: product.id,
        inventoryKey: row.key,
        sku: row.sku,
        pancakeSku: row.pancakeSku,
        pancakeProductId: row.pancakeProductId,
        pancakeVariationId: row.pancakeVariationId,
        name: item.classificationName ? `${product.name} - ${item.classificationName}` : product.name,
        color: String(item.color || ""),
        size: String(item.size || row.size || ""),
        quantity: Math.max(1, Math.min(100, Math.floor(Number(item.qty) || 1))),
        unitPrice: Math.max(0, Math.floor(Number(item.price) || 0))
      };
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Không thể khôi phục sản phẩm trong đơn cũ." }, { status: 409 });
  }

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const total = Math.max(0, Math.floor(Number(body.total) || subtotal));
  const paymentMethod = paymentMethods.has(body.paymentMethod || "cod") ? body.paymentMethod || "cod" : "cod";
  const now = new Date().toISOString();
  const order: ShopOrder = {
    id: crypto.randomUUID(),
    code,
    status: "pending",
    paymentMethod,
    paymentProvider: paymentMethod,
    customer: {
      name: customer.name.trim(),
      phone: customer.phone.trim(),
      address: customer.address.trim(),
      email: customer.email?.trim(),
      note: body.note?.trim()
    },
    items,
    subtotal,
    discount: Math.max(0, subtotal - total),
    shipping: Math.max(0, total - subtotal),
    shippingMethod: body.shippingMethod || "Viettel Post",
    shippingCarrier: "Viettel Post",
    trackingCode: body.trackingCode,
    shippingStatus: "not_created",
    total,
    inventoryReservationApplied: true,
    createdAt: now,
    updatedAt: now
  };

  await createOrder(order);
  try {
    const synced = await new OrderSyncService().create(order);
    return NextResponse.json({ ok: true, order: synced || order, recovered: true });
  } catch {
    const saved = await findOrderByCode(code);
    return NextResponse.json({ ok: true, order: saved || order, recovered: true, queued: true });
  }
}
