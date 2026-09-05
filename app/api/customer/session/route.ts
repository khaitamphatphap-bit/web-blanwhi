import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  createCustomerToken,
  customerSessionCookieOptions,
  newCustomerDeviceId,
  readCustomerSessionFromCookieHeader,
  sanitizeCustomerDeviceId
} from "@/lib/customer-session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { deviceId?: string };
  const existingDeviceId = readCustomerSessionFromCookieHeader(request.headers.get("cookie"));
  const deviceId = existingDeviceId || sanitizeCustomerDeviceId(body.deviceId) || newCustomerDeviceId();
  const response = NextResponse.json({
    deviceId,
    claimUrl: new URL(`/api/customer/claim?token=${encodeURIComponent(createCustomerToken(deviceId, "claim"))}`, request.url).toString()
  }, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  response.cookies.set(CUSTOMER_SESSION_COOKIE, createCustomerToken(deviceId, "session"), customerSessionCookieOptions());
  return response;
}
