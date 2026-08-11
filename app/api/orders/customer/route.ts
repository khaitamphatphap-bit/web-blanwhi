import { NextResponse } from "next/server";
import { readOrders, writeOrders } from "@/lib/orders";

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
  const body = await request.json().catch(() => ({})) as { identities?: CustomerIdentity[]; deviceId?: string };
  const deviceId = String(body.deviceId || "").trim().slice(0, 100);
  const identities = (Array.isArray(body.identities) ? body.identities : [])
    .slice(0, 5)
    .map((identity) => ({ phone: phoneKey(identity.phone), address: addressKey(identity.address) }))
    .filter((identity) => identity.phone.length >= 10 && identity.address.length >= 8);

  if (!identities.length && !deviceId) {
    return NextResponse.json({ orders: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  }

  const orders = await readOrders();
  const matched = orders.filter((order) => {
    if (deviceId && order.customerDeviceId === deviceId) return true;
    const phone = phoneKey(order.customer.phone);
    const address = addressKey(order.customer.address);
    return identities.some((identity) => identity.phone === phone && identity.address === address);
  });

  if (deviceId && matched.some((order) => !order.customerDeviceId)) {
    const matchedCodes = new Set(matched.map((order) => order.code));
    await writeOrders(orders.map((order) => matchedCodes.has(order.code) && !order.customerDeviceId
      ? { ...order, customerDeviceId: deviceId, updatedAt: new Date().toISOString() }
      : order));
  }

  return NextResponse.json({ orders: matched.slice(0, 100) }, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
