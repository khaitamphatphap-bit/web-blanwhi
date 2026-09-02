import { after, NextResponse } from "next/server";
import { readIntegrationConfig } from "@/lib/integrations";
import { readOrders } from "@/lib/orders";
import { reconcileZaloPayPayment, syncVerifiedOrderToPos } from "@/lib/payment-confirmation";
import type { ShopOrder } from "@/lib/types";

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

async function refreshCustomerPaymentStatuses(orders: ShopOrder[]) {
  const pendingZaloPayOrders = orders.filter((order) => order.status === "pending" && order.paymentMethod === "zalopay");
  if (!pendingZaloPayOrders.length) return orders;
  const integrations = await readIntegrationConfig();
  const refreshed = await Promise.all(pendingZaloPayOrders.map(async (order) => {
    try {
      const next = await reconcileZaloPayPayment(order, integrations.payment, { syncPos: false });
      if (next.status === "paid") after(() => syncVerifiedOrderToPos(next));
      return next;
    } catch {
      return order;
    }
  }));
  const byCode = new Map(refreshed.map((order) => [order.code, order]));
  return orders.map((order) => byCode.get(order.code) || order);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { identities?: CustomerIdentity[]; deviceId?: string; knownCodes?: string[] };
  const deviceId = String(body.deviceId || "").trim().slice(0, 100);
  const knownCodes = new Set((Array.isArray(body.knownCodes) ? body.knownCodes : [])
    .slice(0, 100)
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
  const refreshed = await refreshCustomerPaymentStatuses(matched);

  return NextResponse.json({ orders: refreshed.slice(0, 100) }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
