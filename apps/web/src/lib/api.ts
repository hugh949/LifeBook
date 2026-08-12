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
  const message = parsedMessage ?? (body?.trim() || "(empty)");
  const isUnreachable =
    status === 502 &&
    (message.includes("fetch failed") ||
      message.includes("API proxy error") ||
      message.includes("API_UPSTREAM"));
  if (isUnreachable) {
    console.warn(
      "[LifeBook API] Backend unreachable. Start the API (e.g. docker compose up) or set API_UPSTREAM in .env.local / Web App settings."
    );
    return;
  }
  const detail = body.length > 500 ? body.slice(0, 500) + "..." : body;
  console.error(
    `[LifeBook API] ${method} ${path} failed (${status}): ${message}`,
    { status, url, responseBody: detail || "(empty)" }
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

export type ApiOptions = RequestInit & {
  /**
   * HTTP statuses that should be thrown but NOT logged via console.error.
   * Use for probes where a non-2xx is an expected branch of the state
   * machine (e.g. `GET /auth/me` returning 401 when signed out).
   */
  silentStatuses?: number[];
};

function splitInit(init?: ApiOptions): { init: RequestInit | undefined; silent: number[] } {
  if (!init) return { init: undefined, silent: [] };
  const { silentStatuses, ...rest } = init;
  return { init: rest, silent: silentStatuses ?? [] };
}

export async function apiGet<T>(path: string, init?: ApiOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, { credentials: "include", cache: "no-store", ...fetchInit });
  if (!res.ok) {
    const { msg, body } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("GET", path, res.status, url, body, msg);
    }
    throw new Error(msg || `GET ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown, init?: ApiOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(fetchInit?.headers || {}) },
    body: JSON.stringify(body),
    ...fetchInit,
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("POST", path, res.status, url, resBody, msg);
    }
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
      credentials: "include",
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

export async function apiPatch<T>(path: string, body: unknown, init?: ApiOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(fetchInit?.headers || {}) },
    body: JSON.stringify(body),
    ...fetchInit,
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("PATCH", path, res.status, url, resBody, msg);
    }
    throw new Error(msg || `PATCH ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete(path: string, init?: ApiOptions): Promise<void> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, { method: "DELETE", credentials: "include", ...fetchInit });
  if (!res.ok) {
    const { msg, body } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("DELETE", path, res.status, url, body, msg);
    }
    throw new Error(msg || `DELETE ${path} failed: ${res.status}`);
  }
}

/**
 * Fetch a binary response (e.g. narration MP3) with session cookies.
 * Prefer this over putting auth-gated URLs on <audio src>, which cannot
 * surface JSON errors and may race with cache-busting query params.
 */
export async function apiGetBlob(path: string, init?: ApiOptions): Promise<Blob> {
  const result = await apiGetBlobWithMeta(path, init);
  return result.blob;
}

/** Like apiGetBlob, but also returns selected response headers (e.g. narration voice). */
export async function apiGetBlobWithMeta(
  path: string,
  init?: ApiOptions
): Promise<{ blob: Blob; headers: Headers }> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, { credentials: "include", cache: "no-store", ...fetchInit });
  if (!res.ok) {
    const { msg, body } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("GET", path, res.status, url, body, msg);
    }
    throw new Error(msg || `GET ${path} failed: ${res.status}`);
  }
  const blob = await res.blob();
  if (!blob || blob.size < 32) {
    throw new Error("Audio response was empty.");
  }
  const type = (blob.type || res.headers.get("content-type") || "").toLowerCase();
  if (type.includes("json") || type.includes("text/html") || type.includes("text/plain")) {
    throw new Error("Server returned an error instead of audio.");
  }
  return { blob, headers: res.headers };
}

/** POST multipart/form-data (e.g. file upload). Do not set Content-Type so browser sets boundary. */
export async function apiPostFormData<T>(path: string, formData: FormData, init?: ApiOptions): Promise<T> {
  const url = `${API_BASE}${path}`;
  const { init: fetchInit, silent } = splitInit(init);
  const res = await fetch(url, {
    method: "POST",
    body: formData,
    ...fetchInit,
    headers: { ...(fetchInit?.headers || {}) },
  });
  if (!res.ok) {
    const { msg, body: resBody } = await parseErrorResponse(res);
    if (!silent.includes(res.status)) {
      logApiError("POST", path, res.status, url, resBody, msg);
    }
    throw new Error(msg || `POST ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
