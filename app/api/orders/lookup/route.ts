import { NextResponse } from "next/server";
import { readOrders } from "@/lib/orders";

const lookupWindows = new Map<string, { count: number; resetAt: number }>();

function mayLookup(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const key = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const now = Date.now();
  const current = lookupWindows.get(key);
  if (!current || current.resetAt <= now) {
    lookupWindows.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

function phoneKey(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("84") && digits.length > 10 ? `0${digits.slice(2)}` : digits;
}

function maskPhone(value: string) {
  const phone = phoneKey(value);
  if (phone.length < 7) return "••••••";
  return `${phone.slice(0, 4)}•••${phone.slice(-3)}`;
}

function maskName(value: string) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => index === 0 ? part : `${part.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(4, part.length - 1)))}`)
    .join(" ");
}

function maskAddress(value: string) {
  const address = String(value || "").trim();
  if (!address) return "Địa chỉ đã được ẩn";
  const visible = address.slice(0, Math.min(8, address.length));
  return `${visible}${address.length > visible.length ? "••••••••" : ""}`;
}

export async function POST(request: Request) {
  if (!mayLookup(request)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh. Vui lòng chờ một phút rồi thử lại." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phone = phoneKey(body.phone);
  if (phone.length < 10 || phone.length > 11) {
    return NextResponse.json({ error: "Vui lòng nhập đúng số điện thoại đã đặt hàng." }, { status: 400 });
  }

  const orders = (await readOrders())
    .filter((order) => phoneKey(order.customer.phone) === phone)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 500)
    .map((order) => ({
      ...order,
      customerDeviceId: undefined,
      customerDeviceBoundAt: undefined,
      checkoutRequestId: undefined,
      providerOrderId: undefined,
      paymentProviderOrderId: undefined,
      pancakeOrderId: undefined,
      externalSync: undefined,
      transactionId: undefined,
      refundId: undefined,
      refundTransactionId: undefined,
      providerMessage: undefined,
      lookupOnly: true,
      customer: {
        name: maskName(order.customer.name),
        phone: maskPhone(order.customer.phone),
        address: maskAddress(order.customer.address),
        note: undefined
      },
      deliveryDriver: order.deliveryDriver ? {
        name: order.deliveryDriver.name ? maskName(order.deliveryDriver.name) : undefined,
        plateNumber: order.deliveryDriver.plateNumber
      } : undefined
    }));

  return NextResponse.json({ orders, count: orders.length }, {
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" }
  });
}
