import { NextResponse } from "next/server";
import { refreshCustomerVisiblePaymentStatuses } from "@/lib/customer-payment-status";
import { readCustomerSessionFromCookieHeader } from "@/lib/customer-session";
import { readOrders } from "@/lib/orders";

type CustomerIdentity = {
  phone?: string;
  address?: string;
};

function phoneKey(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.startsWith("84") && digits.length > 10 ? `0${digits.slice(2)}` : digits;
}

function addressKey(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { identities?: CustomerIdentity[]; deviceId?: string; knownCodes?: string[]; offset?: number; limit?: number };
  const deviceId = readCustomerSessionFromCookieHeader(request.headers.get("cookie"))
    || String(body.deviceId || "").trim().slice(0, 100);
  const offset = Math.max(0, Math.min(10_000, Math.floor(Number(body.offset) || 0)));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 100)));
  const knownCodes = new Set((Array.isArray(body.knownCodes) ? body.knownCodes : [])
    .slice(0, 500)
    .map((code) => String(code || "").trim().toUpperCase())
    .filter(Boolean));
  const identities = (Array.isArray(body.identities) ? body.identities : [])
    .slice(0, 5)
    .map((identity) => ({ phone: phoneKey(identity.phone), address: addressKey(identity.address) }))
    .filter((identity) => identity.phone.length >= 10 && identity.address.length >= 8);

  if (!identities.length && !deviceId) {
    return NextResponse.json({ orders: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const orders = await readOrders();
  const matched = orders.filter((order) => {
    if (deviceId && order.customerDeviceId === deviceId && order.customerDeviceBoundAt) return true;
    if (!knownCodes.has(order.code.toUpperCase())) return false;
    const phone = phoneKey(order.customer.phone);
    const address = addressKey(order.customer.address);
    return identities.some((identity) => identity.phone === phone && identity.address === address);
  });
  const page = matched.slice(offset, offset + limit);
  const refreshed = await refreshCustomerVisiblePaymentStatuses(page, { source: "Đơn hàng của tôi" });

  return NextResponse.json({
    orders: refreshed,
    total: matched.length,
    nextOffset: offset + refreshed.length,
    hasMore: offset + refreshed.length < matched.length
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
