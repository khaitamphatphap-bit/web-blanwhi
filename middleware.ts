import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="BLANWHI Admin", charset="UTF-8"'
    }
  });
}

function adminUnavailable() {
  return new NextResponse("Admin authentication is not configured", {
    status: 503,
    headers: { "Cache-Control": "no-store" }
  });
}

function safeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host")?.split(":")[0];
  if (host === "blanwhi.com") {
    const url = request.nextUrl.clone();
    url.hostname = "www.blanwhi.com";
    url.protocol = "https";
    return NextResponse.redirect(url, 308);
  }

  if (pathname === "/preview.html") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url, 308);
  }

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/preview.html";
    return NextResponse.rewrite(url);
  }

  const publicPath =
    pathname === "/payment-result" ||
    pathname === "/chinh-sach" ||
    pathname.startsWith("/api/orders") ||
    pathname.startsWith("/api/payments") ||
    pathname.startsWith("/api/inventory") ||
    pathname.startsWith("/api/delivery") ||
    pathname.startsWith("/api/geo") ||
    (pathname === "/api/site" && request.method === "GET") ||
    pathname.startsWith("/uploads/") ||
    pathname.startsWith("/product-placeholder") ||
    pathname.startsWith("/umbrella-logo") ||
    pathname.startsWith("/blanwhi-fabric-stack");
  if (publicPath) return NextResponse.next();

  const cronPath =
    pathname === "/api/admin/orders/shipping-sync" ||
    pathname === "/api/admin/pancake/poll";
  const cronSecret = process.env.CRON_SECRET;
  const cronAuthorization = request.headers.get("authorization");
  if (cronPath && cronSecret && cronAuthorization === `Bearer ${cronSecret}`) {
    return NextResponse.next();
  }

  const protectedPath =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    (pathname === "/api/site" && request.method !== "GET");
  if (!protectedPath) return NextResponse.next();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return adminUnavailable();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized();
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return unauthorized();
  const inputUsername = decoded.slice(0, separator);
  const inputPassword = decoded.slice(separator + 1);

  if (!safeEqual(inputUsername, username) || !safeEqual(inputPassword, password)) return unauthorized();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
