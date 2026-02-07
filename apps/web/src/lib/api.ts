// Use /api so Next.js rewrites to backend (Docker: api:8000, local: localhost:8000)
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...init, cache: "no-store" });
  if (!res.ok) {
    const msg = await errorMessage(res);
    throw new Error(msg || `GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    if (j.detail) return typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
  } catch {
    if (text) return text.slice(0, 300);
  }
  return res.statusText || `Request failed: ${res.status}`;
}

export async function apiPost<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    const msg = await errorMessage(res);
    throw new Error(msg || `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPatch<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    body: JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    const msg = await errorMessage(res);
    throw new Error(msg || `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
