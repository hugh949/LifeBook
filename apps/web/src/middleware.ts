/**
 * Handle GET /api/proxy-ping here so it works even if the App Router route fails on Azure.
 * Returns 200 JSON so you can confirm the app is running and proxy code is deployed.
 */
import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: "/api/proxy-ping",
};

export function middleware(request: NextRequest) {
  if (request.method !== "GET") {
    return NextResponse.next();
  }
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
