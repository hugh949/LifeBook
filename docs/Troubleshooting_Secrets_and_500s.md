# Troubleshooting: "All keys are in GitHub" but 500s persist

If GitHub Secrets are set but the API still returns 500 (e.g. on Memory Bank, Talk, or /media/sas), check the following.

## Root cause (Web App 500s): build-time vs runtime API proxy

**What was wrong:** Next.js `rewrites()` in `next.config.js` are applied at **build time**. The Web App is built in GitHub Actions where `API_UPSTREAM` is not set, so the built app had `destination: "http://localhost:8000/:path*"`. On Azure, the Web App has `API_UPSTREAM` set at runtime, but the rewrite config was already baked in, so every `/api/*` request was sent to localhost on the Web App server (nothing listening) → **500 Internal Server Error**. The Container App API was healthy when hit directly.

**Fix:** We no longer use rewrites for `/api`. A **runtime** proxy is implemented in `apps/web/src/app/api/[...path]/route.ts`, which reads `process.env.API_UPSTREAM` on each request. So the Web App’s app setting is used and `/api/*` correctly reaches the Container App. Ensure the Web App has **Application setting** `API_UPSTREAM` set to your Container App URL (e.g. `https://<your-container-app>.azurecontainerapps.io`).

## 1. Confirm secrets reach the Container App

- **In GitHub Actions:** Run "Deploy API" and open the "Deploy to Container Apps" step. You should see:
  ```
  Secrets present (will be sent to Container App):
    DATABASE_URL: set
    AZURE_STORAGE_ACCOUNT: set
    AZURE_STORAGE_ACCOUNT_KEY: set
    ...
  ```
  If any show `(empty)`, that secret is missing or not available to the workflow (check repo Settings → Secrets).

- **In Azure Portal:** Container App → **Containers** → your container → **Environment variables**. Confirm the same names exist and have values (values may be masked). If they’re missing, the deploy step may have failed or an old revision may be serving traffic.

## 2. Traffic is on the latest revision

After each deploy, a **new revision** is created. If traffic is still on an old revision, it may have old or no env vars.

- **CLI:** `./scripts/azure-api-status.sh list` then `./scripts/azure-api-status.sh traffic <NEWEST_REVISION>=100`
- **Portal:** Container App → **Revisions and replicas** → set 100% traffic to the **latest** revision (highest number).

## 3. Azure Storage: containers and key

- **Containers:** In the Storage Account, create two **Blob** containers named exactly `photos` and `audio` if they don’t exist. The API expects these by default.
- **Key:** Use **Access keys** for that Storage Account. Copy the key with no extra spaces or newlines. If you pasted from a multi-line display, re-copy a single line and update the GitHub Secret.
- **Account name:** Must match the Storage Account (e.g. `lifebookv1prod`). Case-sensitive.

### Photos/audio fail to load: 403 CORS (Preflight response is not successful)

The browser loads images and audio directly from Azure Blob URLs. If the Storage Account has no CORS rules, the preflight (OPTIONS) returns **403** and you see “Preflight response is not successful” or “access control checks” in the console.

**Fix:** Set CORS on the Blob service for your Web App origin. From repo root:

```bash
AZURE_STORAGE_ACCOUNT=lifebookv1prod AZURE_STORAGE_ACCOUNT_KEY='<your-key>' ./scripts/azure-storage-cors.sh
```

Use your storage account name and key (same as in GitHub Secrets). The script allows `https://app-lifebook-web-v1.azurewebsites.net` and `http://localhost:3000`. To add another origin: `ALLOWED_ORIGINS='https://your-app.azurewebsites.net http://localhost:3000'` (with the same env vars). Then try loading a photo again.

## 4. DATABASE_URL format

- Use **single** quotes when testing locally; in GitHub Secrets you paste the full URL as one line.
- **Password:** If the password contains `@` or `%`, URL-encode it (`@` → `%40`, `%` → `%25`) in the URL.
- PostgreSQL firewall must allow the Container App (or “Allow Azure services”).

## 5. See the real error

After the latest deploy (with improved error responses), trigger the failing request again and check:

- **Browser console:** The failed request’s response body should be JSON with a `detail` field (e.g. `"Storage SAS failed: ..."` or a DB error). That message is the actual failure reason.
- **Log Stream:** Container App → Log stream. Reproduce the error and look for `media/sas: ...` or `Unhandled exception ...` with the traceback.

Use the `detail` message and traceback to fix the specific misconfiguration (wrong key, missing container, DB URL, etc.).

## 6. Verify the runtime proxy is deployed (still 500s?)

If you still get 500s after setting `API_UPSTREAM` on the Web App, the Web App may be running **old code** (without the runtime proxy).

1. **Check response header:** Open your site, trigger the error (e.g. open Memory Bank), then open **DevTools (F12) → Network**. Click the failing request (e.g. `moments` or `media/sas`). In **Response headers**, look for **`X-LifeBook-Proxy: ok`**.  
   - **If you see it:** New code is deployed; the proxy ran. A 502 with JSON `detail` means the Web App couldn’t reach the Container App (see step 3). A 500 with no such header may be from the API itself (check Container App logs).  
   - **If you don’t see it:** The Web App is still running the old build. Redeploy the Web App (Actions → “Deploy Web” → Run workflow), wait for it to finish, then **restart the Web App** so it picks up the new deployment.

2. **Restart Web App (CLI):**  
   `az webapp restart -g rg-lifebook-v1 -n app-lifebook-web-v1`  
   (Use your resource group and Web App name if different.)

3. **Set API_UPSTREAM again after deploy (optional):** The deploy workflow sets it automatically. To set manually:  
   `./scripts/set-webapp-api-upstream.sh`

## 8. API proxy error: fetch failed

If you see **"API proxy error: fetch failed. Is API_UPSTREAM set on the Web App? Check Web App Log stream for details."** (502), the web app's proxy tried to call the API at `API_UPSTREAM` but the request failed (connection refused, DNS, or timeout).

**Quick checks in any environment:**

- **Proxy present:** Open `/api/proxy-ping` in the browser. You should get 200 and JSON like `{ "proxy": true, "upstreamSet": true }`. If `upstreamSet` is false, `API_UPSTREAM` is not set (or not visible to the proxy).
- **API reachable:** Call the API directly at `{API_UPSTREAM}/health` (or `http://localhost:8000/health` locally). If that fails, the proxy will always get "fetch failed".

### Local with Docker (`./scripts/run-local.sh`)

`API_UPSTREAM` is set in `docker-compose.yml` to `http://api:8000`. "Fetch failed" usually means the **API container is not running or not ready**.

1. Use one command so both API and web start: `./scripts/run-local.sh` (or `docker compose up --build`) from the repo root.
2. Wait until the API is up (e.g. `http://localhost:8000/health` returns 200) before using http://localhost:3000.
3. If it still fails: `docker compose ps` — `api` and `web` should be Up. Restart with `docker compose up --build` if the API exited.

### Local without Docker (e.g. `npm run dev` in `apps/web`)

The proxy defaults to `http://localhost:8000` when `API_UPSTREAM` is not set. "Fetch failed" means nothing is listening on port 8000.

1. Start the API on port 8000 (with Postgres running and `DATABASE_URL` in `.env`):  
   `cd services/api && pip install . && alembic upgrade head && uvicorn app.main:app --reload --port 8000`
2. In another terminal: `cd apps/web && npm run dev`.
3. Optional: in `apps/web/.env.local` set `API_UPSTREAM=http://localhost:8000` (see `apps/web/.env.local.example`).

### Production (Azure Web App)

The Web App must have **API_UPSTREAM** set to your Container App URL (e.g. `https://<container-app-name>.azurecontainerapps.io`). The deploy workflow sets it; "fetch failed" means it's missing/wrong or the Container App is down.

1. **Check API_UPSTREAM:** Azure Portal → your **Web App** → **Configuration** → **Application settings**. Ensure `API_UPSTREAM` exists and is the full Container App URL (https, no trailing slash).
2. **Set or fix it:** Run `./scripts/set-webapp-api-upstream.sh` from the repo root, or set `API_UPSTREAM` manually in the Web App's Application settings.
3. **Confirm the API is up:** Open `https://<your-container-app-url>/health` in a browser; it should return 200.
4. **Web App logs:** Web App → **Log stream**. Reproduce the error and look for `[LifeBook proxy] upstream request failed` to see the exact failure (see section 7).

## 7. No log stream messages

- **Container App log stream:** If you see “no logs” or “Could not find a replica”, the app may be **scaled to zero** or the replica may have just started. Send a request to the API (e.g. open the site and click something that calls `/api`), wait a few seconds, then open Log stream again. If traffic is on a revision with 0 replicas, switch traffic to a revision that has replicas (or wait for scale-up).  
- **Web App log stream:** Errors from the **proxy** (e.g. “upstream request failed”) are logged by the **Web App** (Node process), not the Container App. Enable **Application Logging** for the Web App: Azure Portal → Web App → **App Service logs** → Application Logging **On** (e.g. File System), Level **Information** or **Error**, then **Log stream** for the Web App. Reproduce the error and look for `[LifeBook proxy] upstream request failed` to see why the Web App couldn’t reach the Container App.
