import { NextResponse } from "next/server";
import { readCustomerAddresses, saveCustomerAddress } from "@/lib/customer-addresses";
import { readCustomerSessionFromCookieHeader } from "@/lib/customer-session";

export const dynamic = "force-dynamic";

const maxRequestBytes = 8 * 1024;

function noStoreJson(value: unknown, init?: ResponseInit) {
  const response = NextResponse.json(value, init);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  return response;
}

function customerDeviceId(request: Request) {
  return readCustomerSessionFromCookieHeader(request.headers.get("cookie"));
}

export async function GET(request: Request) {
  const deviceId = customerDeviceId(request);
  if (!deviceId) return noStoreJson({ error: "Phiên khách chưa sẵn sàng." }, { status: 401 });
  try {
    return noStoreJson({ addresses: await readCustomerAddresses(deviceId) });
  } catch (error) {
    console.error("[customer addresses] read failed", error);
    return noStoreJson({ error: "Chưa tải được địa chỉ đã lưu." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const deviceId = customerDeviceId(request);
  if (!deviceId) return noStoreJson({ error: "Phiên khách chưa sẵn sàng." }, { status: 401 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxRequestBytes) return noStoreJson({ error: "Thông tin địa chỉ vượt giới hạn." }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > maxRequestBytes) return noStoreJson({ error: "Thông tin địa chỉ vượt giới hạn." }, { status: 413 });
  let body: { address?: unknown };
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    return noStoreJson({ error: "Thông tin địa chỉ không hợp lệ." }, { status: 400 });
  }
  try {
    const addresses = await saveCustomerAddress(deviceId, body.address);
    return noStoreJson({ ok: true, addresses });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chưa lưu được địa chỉ.";
    const status = message.includes("chưa hợp lệ") ? 400 : 503;
    if (status === 503) console.error("[customer addresses] save failed", error);
    return noStoreJson({ error: message }, { status });
  }
}
