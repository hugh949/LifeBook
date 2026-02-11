# Production release — what to run

Use this order every time you release. **Requirement:** All changes must be committed first (release script will fail otherwise).

---

## 1. Confirm GitHub has production `DATABASE_URL`

- **GitHub** → your repo → **Settings** → **Secrets and variables** → **Actions**
- Ensure **`DATABASE_URL`** is set to your **production** Postgres URL (Azure).
- The **Deploy All** workflow runs migrations automatically when this secret is set. If it’s missing, migrations are skipped and you must run them manually (step 2a below).

---

## 2. Back up production DB (required)

Create a snapshot before every release so you can restore if a migration or deploy fails. Run from repo root:

```bash
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/lifebook?sslmode=require'
./scripts/backup-db.sh
```

This creates `lifebook_backup_YYYYMMDD_HHMM.dump` locally. Optionally set `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCOUNT_KEY` to upload the dump to Azure Blob. Keep the dump until the release is verified. See [Backup_And_Recovery.md](Backup_And_Recovery.md) for restore steps.

---

## 3. Run the release script (main step)

From the **LifeBook repo root**:

```bash
cd /Users/hughrashid/Cursor/LifeBook
./scripts/release.sh
```

**This script will:**

1. Run **pre-release checks** (config + **require a clean working tree** — uncommitted changes will fail the script).
2. Ask you to **keep current version** or **bump minor** (e.g. 1.0 → 1.1).
3. **Commit** (if version changed) and **push** to `origin main`.
4. **Trigger Deploy All (Web + API)** in GitHub Actions.

**If you have uncommitted changes:**  
Commit (or stash) first, then run again:

```bash
git add -A && git commit -m "Your message"
./scripts/release.sh
```

**To release a specific version without prompts:**

```bash
./scripts/release.sh 1.2
```

---

## 4. Wait for the workflow

- Open **GitHub** → **Actions** → **Deploy All (Web + API)**.
- Wait until the run is **green** (~5–15 min).
- The **API** job runs **migrations** (if `DATABASE_URL` is set) **before** deploying, so you don’t run migrations by hand unless you prefer to (see below).

---

## 5. Verify production

From repo root:

```bash
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

To also check that the deployed version matches what you released (e.g. 1.1):

```bash
EXPECTED_VERSION=1.1 PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

Then in the browser: open your production URL and confirm the app and key flows (e.g. Shared Memories, Narrate, Talk) work.

---

## If you don’t use the release script

Do the same steps by hand:

1. **Pre-check (optional):**  
   `./scripts/check-deploy-ready.sh --require-clean`

2. **Back up production DB (required):**  
   `./scripts/backup-db.sh` (with production `DATABASE_URL` set).

3. **Commit and push:**  
   `git add -A && git commit -m "Release x.y" && git push origin main`

4. **Trigger deploy:**  
   - **GitHub** → **Actions** → **Deploy All (Web + API)** → **Run workflow**,  
   - or: `gh workflow run deploy-all.yml`

5. **Verify:**  
   `PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh`

---

## If you want to run migrations yourself (optional)

Only needed if **`DATABASE_URL`** is **not** in GitHub Secrets, or you want to run migrations before triggering the workflow.

From a terminal (use the same `DATABASE_URL` as production):

```bash
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/lifebook?sslmode=require'
cd /Users/hughrashid/Cursor/LifeBook
./scripts/prod-migrations.sh
```

Then run the release (step 3) and deploy as above.

---

## Quick reference

| Step | What to run |
|------|-------------|
| 1 | Ensure **DATABASE_URL** is in GitHub Actions secrets (so deploy runs migrations). |
| 2 | **Back up production DB:** `./scripts/backup-db.sh` (keep dump until release verified). |
| 3 | **`./scripts/release.sh`** from repo root (commit everything first). |
| 4 | Wait for **Deploy All (Web + API)** to finish in GitHub Actions. |
| 5 | **`PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh`** (optionally with `EXPECTED_VERSION=x.y`). |

That’s it. The workflow handles migrations when the secret is set.
