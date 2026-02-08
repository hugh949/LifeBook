/**
 * Runtime API proxy: forwards /api/* to API_UPSTREAM.
 *
 * ROOT CAUSE FIX: next.config.js rewrites are evaluated at BUILD time. On Azure,
 * the Web App sets API_UPSTREAM at runtime, but the built app had upstream = "http://localhost:8000",
 * so every /api/* request was sent to localhost on the server and failed with 500.
 *
 * This Route Handler reads API_UPSTREAM at REQUEST time, so the Web App's app setting
 * is used and /api/* correctly reaches the Container App.
 */

import { NextRequest, NextResponse } from "next/server";

const UPSTREAM = process.env.API_UPSTREAM || "http://localhost:8000";

// Response header so you can confirm in browser Network tab that the runtime proxy is deployed
const PROXY_HEADER = "X-LifeBook-Proxy";
const PROXY_HEADER_VALUE = "ok";

function jsonError(status: number, detail: string, type = "ProxyError"): NextResponse {
  return NextResponse.json(
    { detail, type },
    { status, headers: { [PROXY_HEADER]: PROXY_HEADER_VALUE } }
  );
}

// Forward these request headers to the API (skip host, connection, etc.)
const FORWARD_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "authorization",
  "cookie",
  "cache-control",
  "pragma",
];

function buildUpstreamUrl(path: string[], request: NextRequest): string {
  const base = UPSTREAM.replace(/\/$/, "");
  const pathStr = path.length ? path.join("/") : "";
  const search = request.nextUrl.search;
  return `${base}/${pathStr}${search}`;
}

function getForwardHeaders(request: NextRequest): Headers {
  const out = new Headers();
  FORWARD_HEADERS.forEach((name) => {
    const v = request.headers.get(name);
    if (v) out.set(name, v);
  });
  return out;
}

async function proxy(
  request: NextRequest,
  pathSegments: string[] | undefined
): Promise<NextResponse> {
  const path = Array.isArray(pathSegments) ? pathSegments : [];

  // Diagnostic: GET /api/proxy-ping returns 200 so you can confirm the runtime proxy is deployed
  if (request.method === "GET" && path.length === 1 && path[0] === "proxy-ping") {
    return NextResponse.json(
      { proxy: true, upstreamSet: !!process.env.API_UPSTREAM },
      { headers: { [PROXY_HEADER]: PROXY_HEADER_VALUE } }
    );
  }

  const url = buildUpstreamUrl(path, request);
  const method = request.method;
  const headers = getForwardHeaders(request);

  let body: BodyInit | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.text();
    } catch {
      // no body
    }
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
      cache: "no-store",
    });

    let responseBody = await res.text();
    const responseHeaders = new Headers();
    responseHeaders.set(PROXY_HEADER, PROXY_HEADER_VALUE);

    // Forward a few response headers
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower === "content-type" ||
        lower === "cache-control" ||
        lower === "access-control-allow-origin"
      ) {
        responseHeaders.set(key, value);
      }
    });

    // If upstream returns 5xx with non-JSON body, normalize so the client always gets parseable JSON
    if (res.status >= 500 && res.status < 600) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const looksLikeJson =
        ct.includes("application/json") ||
        (responseBody?.trim().startsWith("{") && responseBody?.trim().endsWith("}"));
      if (!looksLikeJson) {
        responseBody = JSON.stringify({
          detail: responseBody?.trim() || "Internal Server Error",
          type: "UpstreamError",
        });
        responseHeaders.set("Content-Type", "application/json");
      }
    }

    return new NextResponse(responseBody, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Upstream request failed";
    console.error(
      "[LifeBook proxy] upstream request failed:",
      { url, method, message, err }
    );
    return jsonError(
      502,
      `API proxy error: ${message}. Is API_UPSTREAM set on the Web App? Check Web App Log stream for details.`
    );
  }
}

async function safeProxy(
  request: NextRequest,
  params: Promise<{ path?: string[] }>
): Promise<NextResponse> {
  try {
    const { path } = await params;
    return await proxy(request, path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[LifeBook proxy] handler error:", err);
    return jsonError(502, `Proxy handler error: ${message}`);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}

export async function OPTIONS(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  return safeProxy(request, params);
}
