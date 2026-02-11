# Deployment Pitfalls and Learnings

**Purpose:** Reference document for future builds and releases. Captures mistakes, root causes, and fixes we discovered during production debugging (especially the "Delete story" 404 issue). Use this to avoid repeating the same problems.

---

## Summary: What Went Wrong and How We Fixed It

| Issue | Root Cause | Fix |
|-------|------------|-----|
| Delete route returned 404 in production | **Multiple causes** (see below) | Route restored, traffic routing fixed, deployment workflow hardened |
| New code not deployed despite correct commit | GitHub Actions reusable workflow checked out wrong ref | Pin checkout to `ref: ${{ github.sha }}` |
| Image had old code despite correct commit | Docker layer cache served stale `COPY app` | Build with `--no-cache`; add `BUILD_SHA` arg |
| New revisions deployed but 404 persisted | **Traffic stayed on old revision** (100% to revision 0000024) | Run `az containerapp ingress traffic set --revision-weight latest=100` after deploy |
| Verify script reported 000 (timeout) | 30s too short for cold starts | Increase timeout to 60s (configurable via `VERIFY_TIMEOUT`) |
| Uncommitted changes left out of deploy | Easy to forget to commit | Release script requires clean repo (`check-deploy-ready.sh --require-clean`) |
| BGM works locally but not in production | `ELEVENLABS_API_KEY` not set in production | Add **ELEVENLABS_API_KEY** to GitHub Secrets; deploy-api workflow must pass it to Container App (see workflow env + ENV_VARS) |

---

## 1. Azure Container Apps: Traffic Routing

### The Problem

When you run `az containerapp update --image X`, Azure creates a **new revision** with the new image. **By default, traffic does NOT switch to the new revision.** All traffic can remain on an old revision indefinitely.

### How to Check

```bash
# See which revision gets traffic
az containerapp ingress show -g rg-lifebook-v1 -n aca-lifebook-api-v1 -o json

# List all revisions and their traffic weights
az containerapp revision list -g rg-lifebook-v1 -n aca-lifebook-api-v1 --all \
  --query "[].{name:name, image:properties.template.containers[0].image, trafficWeight:properties.trafficWeight}" -o table
```

If the latest revision has `trafficWeight: 0` and an old one has `100`, production is serving the old image.

### The Fix

After every successful `az containerapp update`, run:

```bash
az containerapp ingress traffic set \
  --name aca-lifebook-api-v1 \
  --resource-group rg-lifebook-v1 \
  --revision-weight latest=100
```

**In the workflow:** The deploy-api workflow now does this automatically after a successful update.

### Quick Fix (Manual)

If you just deployed and production still shows old behavior:

```bash
az containerapp ingress traffic set -n aca-lifebook-api-v1 -g rg-lifebook-v1 --revision-weight latest=100
```

---

## 2. GitHub Actions: Reusable Workflow Checkout

### The Problem

When a workflow is called via `workflow_call` (e.g. Deploy All calls Deploy API), `actions/checkout` without an explicit `ref` can check out the **branch tip** instead of the **commit that triggered the run**. That can differ if:
- Another push happened between trigger and job start
- The default branch behavior serves stale refs

Result: The API container was built from the wrong commit, so new routes never appeared.

### The Fix

In `.github/workflows/deploy-api.yml`, pin the checkout to the trigger commit:

```yaml
- name: Checkout
  uses: actions/checkout@v4
  with:
    ref: ${{ github.sha }}
```

### Verification Step

We added a "Verify API source" step that greps for the delete route before building. If the route is missing from the checked-out source, the build fails with a clear error instead of silently deploying old code.

---

## 3. Docker Build: Stale Cache Layers

### The Problem

Docker layer cache can reuse a `COPY app` layer from a previous build. If the cache key somehow matches (e.g. subtle filesystem or BuildKit behavior), the image gets old application code even though the repo has the new code.

We observed: Commit had the delete route, image tag was correct, but the **running API's OpenAPI spec had no delete routes**.

### The Fix

1. **Build with `--no-cache`** in the deploy workflow so every build is fresh.
2. **Add `BUILD_SHA` build arg** in the Dockerfile so the app layer is unique per commit:

```dockerfile
ARG BUILD_SHA
RUN echo "${BUILD_SHA:-none}" > /app/.build_sha
COPY app /app/app
```

Workflow passes: `--build-arg BUILD_SHA=${{ github.sha }}`

---

## 4. API Routes: FastAPI Path Ordering

### The Problem

If you have:
- `POST /stories/shared/{moment_id}/delete` (parametric)
- `POST /stories/shared/delete` (static)

And the **parametric route is registered first**, then `GET /voice/stories/shared/delete` matches `moment_id="delete"`. The handler would look up a moment with id "delete" and return 404 "Shared story not found" (our custom message), not FastAPI's default "Not Found". But if the static route is missing entirely, you get FastAPI's `{"detail":"Not Found"}`.

### The Fix

- Register the **static path first**: `POST /stories/shared/delete` before `POST /stories/shared/{moment_id}/delete`.
- Prefer **body-based** endpoints when the ID might be mangled by proxies: `POST /stories/shared/delete` with `{ moment_id, participant_id, code }` in the body instead of `POST /stories/shared/{moment_id}/delete` with ID in the path.

---

## 5. Web App Proxy: API_UPSTREAM

### The Problem

If `API_UPSTREAM` on the Web App includes a path (e.g. `https://api.azurecontainerapps.io/api`), the proxy sends requests to `/api/voice/stories/shared/delete`. The FastAPI app only has routes at `/voice/...`, not `/api/voice/...`, so you get 404.

### The Fix

`API_UPSTREAM` must be the **API base URL only**, no path:

- **Correct:** `https://aca-lifebook-api-v1.xxx.azurecontainerapps.io`
- **Wrong:** `https://aca-lifebook-api-v1.xxx.azurecontainerapps.io/api`

---

## 6. Release Script: Verify Before and After

### Changes Made

1. **Pre-release check** (`check-deploy-ready.sh`):
   - Verifies deploy config (workflow ref, verify step, Dockerfile, critical routes)
   - Warns about uncommitted changes
   - Fails if deploy config is broken

2. **Release flow** (`release.sh`):
   - Step 1: Run pre-release check
   - Step 2: Version & commit (strong prompt: "They will NOT be in production unless you commit them now")
   - Step 3: Push and trigger Deploy All
   - Step 4: Optional wait and run `verify-prod.sh`

3. **Verify script** (`verify-prod.sh`):
   - Timeout increased to 60s (configurable via `VERIFY_TIMEOUT`)
   - Added delete-endpoint check (`GET /api/voice/stories/shared/delete`)

---

## 7. Debugging Production API

### Check What the Running API Actually Has

```bash
# Get registered routes from the running API
curl -s "https://aca-lifebook-api-v1.xxx.azurecontainerapps.io/openapi.json" | \
  python3 -c "import json,sys; d=json.load(sys.stdin); print([p for p in d.get('paths',{}) if 'delete' in p.lower()])"
```

If this returns `[]` but the repo has the route, the running image either has old code or traffic is on an old revision.

### Check Deployed Image and Traffic

```bash
# What image is configured
az containerapp show -g rg-lifebook-v1 -n aca-lifebook-api-v1 \
  --query "properties.template.containers[0].image" -o tsv

# Which revision gets traffic
az containerapp ingress show -g rg-lifebook-v1 -n aca-lifebook-api-v1 -o json
```

### Hit the API Directly (Bypass Web App Proxy)

```bash
# Direct to Container App
curl "https://aca-lifebook-api-v1.xxx.azurecontainerapps.io/voice/stories/shared/delete"

# Via Web App proxy
curl "https://app-lifebook-web-v1.azurewebsites.net/api/voice/stories/shared/delete"
```

If direct works but proxy fails, the issue is in the proxy or `API_UPSTREAM`. If both fail, the issue is in the API or traffic routing.

---

## 8. Aggressive parity (code + image)

To ensure production runs the exact same code/image as the build:

- **Release script:** After `git push`, verifies `origin/main == HEAD`; exits if not (so the workflow will build the right commit).
- **Deploy workflow:** Checkout pins `ref: ${{ github.sha }}`; build uses `--no-cache` and `BUILD_SHA=${{ github.sha }}`; source step greps for delete route and BGM (narrate/bgm + ElevenLabs); after deploy, a step verifies production `/health` returns `build_sha == github.sha` (fail if mismatch).
- **API /health:** Returns `build_sha` from the image (baked at build time from `BUILD_SHA`). Used by the workflow and by `verify-prod.sh` with `EXPECTED_BUILD_SHA`.

Optional local check:  
`EXPECTED_BUILD_SHA=<commit-sha> PROD_WEB_URL=... ./scripts/verify-prod.sh` to confirm the API in production is from that commit.

---

## 9. Checklist for Future Deployments

Before releasing:

1. Run `./scripts/check-deploy-ready.sh --require-clean` (or let `release.sh` do it) — fix any failures.
2. Commit all changes; release script **fails** if anything is uncommitted.
3. Run `./scripts/release.sh` (or trigger Deploy All manually).
4. Wait for workflow to complete (both Web and API jobs green). The API job **fails** if production `build_sha` ≠ commit.
5. Run `./scripts/verify-prod.sh` — all checks should pass. Optionally `EXPECTED_BUILD_SHA=<sha> PROD_WEB_URL=... ./scripts/verify-prod.sh`.
6. If a new API route still 404s:
   - Check traffic: `az containerapp ingress show` and `revision list`
   - Route traffic to latest: `az containerapp ingress traffic set --revision-weight latest=100`
   - Check OpenAPI: `curl .../openapi.json` and inspect `paths`

---

## Files Changed (Reference)

| File | Change |
|------|--------|
| `.github/workflows/deploy-api.yml` | Checkout `ref: ${{ github.sha }}`; verify step; `--no-cache` build; traffic set to latest after update |
| `services/api/Dockerfile` | `ARG BUILD_SHA` and `RUN echo ...` before `COPY app` |
| `services/api/app/routers/voice.py` | GET + POST `/stories/shared/delete`; body-based preferred; static route before parametric |
| `apps/web/src/app/bank/page.tsx` | Call `POST /voice/stories/shared/delete` with `moment_id` in body |
| `scripts/release.sh` | Pre-release check; stronger commit prompt; optional post-verify |
| `scripts/check-deploy-ready.sh` | New: deploy config + verify-prod + workflow checks |
| `scripts/verify-prod.sh` | 60s timeout; delete-endpoint check |
| `apps/web/.env.local.example` | Comment: API_UPSTREAM must be base URL only |

---

## Related Docs

- **Release_Process.md** — Normal release flow and script reference
- **Production_Release_Steps.md** — Full first-time or migration-including flow
- **Troubleshooting_Secrets_and_500s.md** — Secrets and HTTP errors
