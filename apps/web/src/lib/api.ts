// Use /api so Next.js rewrites to backend (Docker: api:8000, local: localhost:8000)
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "/api";

function logApiError(
  method: string,
  path: string,
  status: number,
  url: string,
  body: string,
  parsedMessage?: string
): void {
  let detail = body.length > 500 ? body.slice(0, 500) + "..." : body;
  if (!detail || detail.trim() === "" || detail.trim() === "{}") {
    detail = "(empty)";
  }
  const message = parsedMessage ?? detail;
  console.error(
    `[LifeBook API] ${method} ${path} failed (${status}): ${message}`,
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
    logApiError("GET", path, res.status, url, body, msg);
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
    logApiError("POST", path, res.status, url, resBody, msg);
    throw new Error(msg || `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiGetWithTimeout<T>(path: string, timeoutMs: number, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      const { msg, body } = await parseErrorResponse(res);
      logApiError("GET", path, res.status, url, body, msg);
      throw new Error(msg || `GET ${path} failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  } finally {
    clearTimeout(id);
  }
}

export async function apiPostWithTimeout<T>(path: string, body: unknown, timeoutMs: number, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      body: JSON.stringify(body),
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const { msg, body: resBody } = await parseErrorResponse(res);
      logApiError("POST", path, res.status, url, resBody, msg);
      throw new Error(msg || `POST ${path} failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  } finally {
    clearTimeout(id);
  }
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
    logApiError("PATCH", path, res.status, url, resBody, msg);
    throw new Error(msg || `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string, init?: RequestInit): Promise<void> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { method: "DELETE", ...init });
  if (!res.ok) {
    const { msg, body } = await parseErrorResponse(res);
    logApiError("DELETE", path, res.status, url, body, msg);
    throw new Error(msg || `DELETE ${path} failed: ${res.status}`);
  }
}

/** POST multipart/form-data (e.g. file upload). Do not set Content-Type so browser sets boundary. */
export async function apiPostFormData<T>(path: string, formData: FormData, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    ...init,
    headers: { ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    logApiError("POST", path, res.status, url, resBody, msg);
    throw new Error(msg || `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
