# Production release — step-by-step

Use this when you have **GitHub secrets and variables already set** and want to release the current code to production. For this major release you may wipe production data first; in future releases you will preserve data and only run migrations.

**Assumptions:** You are on the LifeBook repo, Azure resources exist (Web App, Container App, Postgres, Storage), and all keys from `.env` are in GitHub Actions secrets.

**Scripts and actions in order:**

| Step | What to run / do |
|------|-------------------|
| 1 | `export DATABASE_URL='postgresql+psycopg://...'` (production URL; required locally for migrations + wipe—GitHub secret is only for the deploy workflow) |
| 2 | (This release) Back up production DB (optional but recommended). |
| 3 | `cd services/api && uv run alembic upgrade head` (create/update schema; **do this before wipe** if the DB is new or old) |
| 4 | (This release, optional) `cd services/api && uv run python scripts/wipe_all_participants_and_data.py --confirm` — only after migrations; skip if DB is already empty. |
| 5 | `./scripts/deploy-to-azure.sh` (from repo root) |
| 6 | **Actions → Deploy All (Web + API) → Run workflow** (or `gh workflow run deploy-all.yml`) |
| 7 | `PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh` |

---

## 1. Set production DATABASE_URL locally (required for steps 2 and 3)

You still need to set **production** `DATABASE_URL` in your **local** shell for the wipe and migration steps, even if `DATABASE_URL` is already in GitHub Secrets. Those secrets are only used by the deploy workflow when it configures the Container App; the wipe script and Alembic run **on your machine** and must connect to the production database themselves.

- **From Azure Portal:** PostgreSQL Flexible Server → your server → **Connection strings** (or **Server name** + **Admin username** + password). Format:
  ```text
  postgresql+psycopg://USER:PASSWORD@HOST:5432/lifebook
  ```
- **From GitHub:** You can’t read a secret back from GitHub. Use the same value you used when you added `DATABASE_URL` to the Container App or to GitHub Secrets (e.g. from a password manager or Azure). If you no longer have it, set a new admin password in Azure and build the URL.

Set it in your shell (replace with your real URL; no spaces around `=`):

```bash
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/lifebook'
```

Use a **dedicated terminal** for the next steps so `DATABASE_URL` stays set, or re-export it in each new terminal.

---

## 2. (This release only) Back up production DB

Because this release replaces the old app, a backup is recommended before any schema or data changes.

From any machine that can reach the production Postgres (e.g. your laptop with `psql` or Azure CLI):

```bash
pg_dump "$DATABASE_URL" -F c -f lifebook_prod_backup_$(date +%Y%m%d_%H%M).dump
```

Or use Azure Portal: PostgreSQL server → **Backup** and note the automated backups / create an on-demand backup if available.

---

## 3. Run migrations on the production database

Still in the same shell (with `DATABASE_URL` set to production), from the API directory:

```bash
cd /Users/hughrashid/Cursor/LifeBook/services/api
uv run alembic upgrade head
```

You should see migrations run (or “already at head”). If you get connection errors, check that `DATABASE_URL` is correct and that your IP is allowed (Azure Postgres → Server → Networking / Firewall).

---

## 4. (This release only, optional) Wipe participant and family data

The wipe script requires the **current** schema (all tables from step 3). Run it only **after** migrations. If the production DB was empty or from the old app, after migrations the new tables are already empty—you can skip the wipe.

```bash
cd /Users/hughrashid/Cursor/LifeBook/services/api
uv run python scripts/wipe_all_participants_and_data.py --confirm
```

Ensure `DATABASE_URL` is still the production URL. If you see `relation "voice_participants" does not exist`, run **step 3 (migrations)** first, then run the wipe if you want to clear any data.

**Future releases:** Skip the wipe step. Only run migrations (step 3).

---

## 5. Push your code to `main`

From the **LifeBook repo root**:

```bash
cd /Users/hughrashid/Cursor/LifeBook
./scripts/deploy-to-azure.sh
```

- If you have uncommitted changes, the script will ask to commit them (message optional).
- It then pushes to `origin main`.

**Note:** Pushing to `main` does **not** deploy by itself. You must run the workflow in step 6.

---

## 6. Run the deploy workflow (required)

Deploy is **manual**: GitHub Actions will not deploy on push.

**Option A — GitHub website**

1. Open your repo on GitHub.
2. Go to **Actions**.
3. In the left sidebar, select **“Deploy All (Web + API)”**.
4. Click **“Run workflow”** (branch: `main`), then **“Run workflow”**.
5. Wait for the run to finish (both Web and API jobs green).

**Option B — GitHub CLI**

From the repo root:

```bash
cd /Users/hughrashid/Cursor/LifeBook
gh workflow run deploy-all.yml
```

Then open **Actions** and watch the **“Deploy All (Web + API)”** run until it completes.

---

## 7. Verify production

Replace the URL with your Web App URL if you use a different name (e.g. from GitHub variable `AZURE_WEBAPP_NAME`):

```bash
cd /Users/hughrashid/Cursor/LifeBook
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

- **Exit 0:** Proxy and API health checks passed.
- **Exit 1:** Check Container App and Web App logs in Azure; confirm env vars (and `API_UPSTREAM` on the Web App) and that the workflow run succeeded.

Then in a browser:

- Open `https://app-lifebook-web-v1.azurewebsites.net` (or your Web App URL).
- Try **Older → Talk** and confirm the app loads and voice connects (if you use OpenAI).
- Optionally: **Family → Upload** and **Memory Bank** to confirm storage and DB.

---

## Quick reference (after first time)

Once you’ve done the full flow once, later releases are usually:

1. **No wipe.** Set `DATABASE_URL` to production only if you need to run new migrations.
2. **Migrations (if you added any):**  
   `cd services/api && uv run alembic upgrade head`  
   (with `DATABASE_URL` set to production.)
3. **Push:**  
   `./scripts/deploy-to-azure.sh`
4. **Deploy:**  
   Actions → **Deploy All (Web + API)** → **Run workflow** (or `gh workflow run deploy-all.yml`).
5. **Verify:**  
   `PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh`

(Steps 2–4 in the main list—backup, migrations, wipe—apply to this major release; for future releases you only run migrations when there are new ones, then push and deploy.)

All keys stay in GitHub; no need to change them for routine releases.
