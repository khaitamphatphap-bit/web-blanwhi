import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  createCustomerToken,
  customerSessionCookieOptions,
  verifyCustomerToken
} from "@/lib/customer-session";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const deviceId = verifyCustomerToken(requestUrl.searchParams.get("token"), "claim");
  const destination = new URL("/", request.url);
  destination.searchParams.set("orders", "1");
  if (!deviceId) destination.searchParams.set("claimError", "1");
  const response = NextResponse.redirect(destination, 303);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (deviceId) {
    response.cookies.set(CUSTOMER_SESSION_COOKIE, createCustomerToken(deviceId, "session"), customerSessionCookieOptions());
  }
  return response;
}
