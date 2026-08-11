import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="BLANWHI Admin", charset="UTF-8"'
    }
  });
}

const fallbackAdmin = {
  username: "admin",
  password: "BlanwhiAdmin@2026!"
};

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
  if (cronPath && request.headers.get("x-vercel-cron") === "1") return NextResponse.next();

  const protectedPath =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin") ||
    (pathname === "/api/site" && request.method !== "GET");
  if (!protectedPath) return NextResponse.next();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(header.slice(6));
  const separator = decoded.indexOf(":");
  const inputUsername = decoded.slice(0, separator);
  const inputPassword = decoded.slice(separator + 1);

  const envLoginOk = Boolean(username && password && inputUsername === username && inputPassword === password);
  const fallbackLoginOk = inputUsername === fallbackAdmin.username && inputPassword === fallbackAdmin.password;

  if (!envLoginOk && !fallbackLoginOk) return unauthorized();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
