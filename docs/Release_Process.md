# Release process and scripts

Use this so production always shows the version you tested locally, and deploys are predictable and verifiable.

---

## Version number

- **Single source of truth:** `apps/web/src/app/version.ts` → `APP_VERSION = "x.y"`.
- Shown in the app nav (e.g. **LifeBook v1.0**) and in the page `<meta name="app-version" content="1.0">` for verification.
- **Rule:** The version in that file is what you want on production after a release. Bump it when you cut a release, then deploy.

---

## Deploy to production (recommended: one command)

From repo root:

```bash
./scripts/release.sh
```

**What it does:**

1. Shows current version and asks: deploy as-is, bump minor (e.g. 1.0 → 1.1), or cancel.
2. If you bump (or pass a version): updates `version.ts`, commits with message `Release x.y`.
3. Commits any other uncommitted changes into that release commit.
4. Pushes to `origin main`.
5. Triggers **Deploy All (Web + API)** via GitHub Actions (if `gh` is installed).
6. Tells you how to verify when the workflow finishes.

**Deploy a specific version without prompts:**

```bash
./scripts/release.sh 1.2
```

Sets version to 1.2, commits, pushes, and triggers deploy.

**Why this fixes “new code didn’t deploy”:** Pushing to `main` does **not** start the workflow by itself. `release.sh` (and the updated `deploy-to-azure.sh`) trigger **Deploy All** after push so the workflow actually runs.

---

## Verify production

After the GitHub Actions run is green:

```bash
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

Checks:

- Web app proxy (`/api/proxy-ping`) returns 200 and `proxy: true`.
- API health (`/api/health`) returns 200.

**Check that the deployed version matches what you released:**

```bash
EXPECTED_VERSION=1.1 PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

Fetches the homepage and checks the `app-version` meta tag. If it doesn’t match, the script exits 1.

---

## Script reference

### Local (testing)

| Goal | Script | Notes |
|------|--------|------|
| Run full stack (db + API + web) | `./scripts/run-local.sh` | Same as `docker compose up --build`. Open http://localhost:3000. |
| Run only DB + API | `./scripts/local-api.sh` | Then run web with `cd apps/web && npm run dev` and `API_UPSTREAM=http://localhost:8000` in `.env.local`. |
| Run DB migrations (local) | `./scripts/run-migrations.sh` | Uses Docker; `DATABASE_URL` from `.env` (db:5432). |

### Production (deploy and DB)

| Goal | Script | Notes |
|------|--------|------|
| **Release (version + commit + push + deploy)** | `./scripts/release.sh` | Preferred for “ship what I tested”. Optionally bump version, then push and trigger Deploy All. |
| Commit + push only (no deploy trigger) | `./scripts/deploy-to-azure.sh` | Still triggers deploy if `gh` is installed (same as before). Prefer `release.sh` for releases. |
| Trigger Deploy All only | `./scripts/prod-deploy-all.sh` | After you’ve already pushed. Requires `gh`. |
| Trigger Deploy Web only | `./scripts/prod-deploy-web.sh` | When only web app or web config changed. |
| Trigger Deploy API only | `./scripts/prod-deploy-api.sh` | When only API or API config changed. |
| Run migrations (production DB) | `./scripts/prod-migrations.sh` | Set `DATABASE_URL` to production Postgres URL first. |
| Verify production | `./scripts/verify-prod.sh` | Optional: `EXPECTED_VERSION=x.y` to check deployed version. |

### One-off manual steps

- **Trigger workflows without `gh`:** GitHub → repo → **Actions** → choose workflow → **Run workflow**.
- **Production migrations:**  
  `export DATABASE_URL='postgresql+psycopg://...'`  
  `./scripts/prod-migrations.sh`

---

## End-to-end release checklist

1. **Local:** Test with `./scripts/run-local.sh` (or `local-api.sh` + `npm run dev`). Confirm version in the UI (e.g. **LifeBook v1.0**).
2. **Release:** From repo root run `./scripts/release.sh`. Choose “bump minor” or “deploy as-is”, confirm commit and push. Script triggers Deploy All.
3. **Wait:** In GitHub Actions, wait until **Deploy All (Web + API)** is green (~5–15 min).
4. **Verify:**  
   `PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh`  
   Optionally: `EXPECTED_VERSION=1.1 PROD_WEB_URL=... ./scripts/verify-prod.sh`.
5. **Confirm in browser:** Open the production URL and check that the nav shows the same version (e.g. **v1.1**).

If anything fails, check Azure Web App and Container App logs and the GitHub Actions run logs.
