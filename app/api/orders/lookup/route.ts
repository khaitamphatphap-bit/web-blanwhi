import { NextResponse } from "next/server";
import { refreshCustomerVisiblePaymentStatuses } from "@/lib/customer-payment-status";
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
  if (digits.length < 9) return digits;

  // Vietnamese numbers may have been saved as 0xxxxxxxxx, 84xxxxxxxxx,
  // +84xxxxxxxxx or 0084xxxxxxxxx. The last 9 digits are the stable
  // national subscriber number shared by all of those representations.
  return digits.slice(-9);
}

function orderPhoneKeys(order: Record<string, any>) {
  return [
    order.customer?.phone,
    order.phone,
    order.customerPhone,
    order.shippingAddress?.phone,
    order.deliveryAddress?.phone,
    order.receiver?.phone
  ].map(phoneKey).filter(Boolean);
}

function maskPhone(value: string) {
  const key = phoneKey(value);
  const phone = key.length === 9 ? `0${key}` : key;
  if (phone.length < 3) return "**********";
  return `${phone.slice(0, 3)}${"*".repeat(Math.max(7, phone.length - 3))}`;
}

function maskName(value: string) {
  const name = String(value || "").trim();
  if (!name) return "*";
  return `${name.slice(0, 1).toLocaleUpperCase("vi-VN")}${"*".repeat(Math.max(3, name.length - 1))}`;
}

function maskAddress(value: string) {
  const address = String(value || "").trim();
  if (!address) return "Địa chỉ đã được ẩn";
  const streetNumber = address.match(/^\s*(\d+)/)?.[1] || "*";
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const knownCity = address.match(/(?:Thành phố\s+)?(?:Hồ Chí Minh|Hà Nội|Đà Nẵng|Cần Thơ|Hải Phòng)|(?:TP\.?\s*HCM|HCM)\b/i)?.[0];
  const lastPart = parts.at(-1) || "";
  const city = String(knownCity || lastPart || "Tỉnh/Thành phố")
    .replace(/^Thành phố\s+/i, "")
    .replace(/^TP\.?\s*HCM$/i, "Hồ Chí Minh")
    .replace(/^HCM$/i, "Hồ Chí Minh");
  const maskedCity = `${city.slice(0, 1).toLocaleUpperCase("vi-VN")}********`;
  return `${streetNumber}***, ${maskedCity}`;
}

export async function POST(request: Request) {
  if (!mayLookup(request)) {
    return NextResponse.json({ error: "Bạn thao tác quá nhanh. Vui lòng chờ một phút rồi thử lại." }, { status: 429 });
  }
  const body = await request.json().catch(() => ({})) as { phone?: string };
  const phone = phoneKey(body.phone);
  if (phone.length !== 9) {
    return NextResponse.json({ error: "Vui lòng nhập đúng số điện thoại đã đặt hàng." }, { status: 400 });
  }

  const matchedOrders = (await readOrders())
    .filter((order) => orderPhoneKeys(order as unknown as Record<string, any>).includes(phone))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());

  const orders = (await refreshCustomerVisiblePaymentStatuses(matchedOrders, { source: "Tra cứu đơn bằng số điện thoại" }))
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
