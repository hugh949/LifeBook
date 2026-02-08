// Use /api so Next.js rewrites to backend (Docker: api:8000, local: localhost:8000)
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

function logApiError(method: string, path: string, status: number, url: string, body: string): void {
  const detail = body.length > 500 ? body.slice(0, 500) + "..." : body;
  console.error(
    `[LifeBook API] ${method} ${path} failed:`,
    { status, url, responseBody: detail }
  );
}

async function parseErrorResponse(res: Response): Promise<{ msg: string; body: string }> {
  const body = await res.text();
  const msg = (() => {
    try {
      const j = JSON.parse(body);
      if (j.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      if (body) return body.slice(0, 300);
    }
    return res.statusText || `Request failed: ${res.status}`;
  })();
  return { msg, body };
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, cache: "no-store" });
  if (!res.ok) {
    const { msg, body } = await parseErrorResponse(res);
    logApiError("GET", path, res.status, url, body);
    throw new Error(msg || `GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    logApiError("POST", path, res.status, url, resBody);
    throw new Error(msg || `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    logApiError("PATCH", path, res.status, url, resBody);
    throw new Error(msg || `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
