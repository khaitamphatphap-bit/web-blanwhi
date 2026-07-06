import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="BLANWHI Admin", charset="UTF-8"'
    }
  });
}

export function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0];
  if (host === "blanwhi.com") {
    const url = request.nextUrl.clone();
    url.hostname = "www.blanwhi.com";
    url.protocol = "https";
    return NextResponse.redirect(url, 308);
  }

  const protectedPath =
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/admin") ||
    (request.nextUrl.pathname === "/api/site" && request.method !== "GET");
  if (!protectedPath) return NextResponse.next();

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;

  if (!username || !password) {
    if (process.env.NODE_ENV === "production") return unauthorized();
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return unauthorized();

  const decoded = atob(header.slice(6));
  const separator = decoded.indexOf(":");
  const inputUsername = decoded.slice(0, separator);
  const inputPassword = decoded.slice(separator + 1);

  if (inputUsername !== username || inputPassword !== password) return unauthorized();
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
