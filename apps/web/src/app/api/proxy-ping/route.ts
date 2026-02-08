/**
 * Diagnostic: GET /api/proxy-ping returns 200 with JSON so you can confirm
 * the runtime proxy code is deployed. No params, no upstream call.
 */
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const upstreamSet = typeof process.env.API_UPSTREAM === "string" && process.env.API_UPSTREAM.length > 0;
    return NextResponse.json(
      { proxy: true, upstreamSet },
      { headers: { "X-LifeBook-Proxy": "ok" } }
    );
  } catch (e) {
    return NextResponse.json(
      { proxy: true, error: String(e), upstreamSet: false },
      { status: 500, headers: { "X-LifeBook-Proxy": "ok" } }
    );
  }
}
