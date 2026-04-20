/**
 * Auth middleware: redirect unauthenticated visitors to /signin for any app page,
 * but leave /signin, /signup, /s/* (public share links) and /api/* (proxy, handles
 * its own auth) alone.
 */
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = process.env.NEXT_PUBLIC_SESSION_COOKIE || "lb_session";

// Paths that anyone (signed-in or not) can visit
const PUBLIC_PATHS: RegExp[] = [
  /^\/signin$/,
  /^\/signup$/,
  /^\/s(?:\/|$)/,
  /^\/favicon\.ico$/,
  /^\/_next\//,
  /^\/api\//,
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((r) => r.test(pathname));
}

export const config = {
  matcher: [
    // Run on everything except Next internals — we still want /api/* to hit the
    // proxy-ping handler below for GET /api/proxy-ping.
    "/((?!_next/static|_next/image).*)",
  ],
};

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Existing /api/proxy-ping diagnostic
  if (request.method === "GET" && pathname === "/api/proxy-ping") {
    try {
      const upstreamSet =
        typeof process.env.API_UPSTREAM === "string" &&
        process.env.API_UPSTREAM.length > 0;
      return NextResponse.json(
        { proxy: true, upstreamSet, via: "middleware" },
        { headers: { "X-LifeBook-Proxy": "ok" } }
      );
    } catch (e) {
      return NextResponse.json(
        { proxy: true, upstreamSet: false, via: "middleware", error: String(e) },
        { status: 200, headers: { "X-LifeBook-Proxy": "ok" } }
      );
    }
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    if (pathname !== "/") {
      url.searchParams.set("next", pathname + request.nextUrl.search);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
