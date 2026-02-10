# Prep for production

Checklist before moving LifeBook to production. Use this when you want to start with a clean database (no test participants or data).

## Data policy: this release vs future releases

- **This major release (replacing the old app):** The database and features have changed significantly. It is acceptable to **wipe** existing production data for this rollout. Back up first, then run the wipe script against production if the old app had data you are replacing. After this release, production will run this codebase and new data will accumulate under the new schema.
- **Future releases:** **Preserve data.** Do not delete production (or meaningful local) data unless it is **absolutely necessary and cannot be migrated**. Prefer migrations, backfills, and schema evolution; use the wipe script only when there is no safe migration path and a full reset is the only option. Document any such decision.

## When to use this (local vs production, releases)

- **Local development:** Use your local `.env` and local database. Develop features, run migrations when you add new ones. You do **not** need to run the wipe script for normal day-to-day work. Run it only if you want to reset local data to a clean state.
- **Releasing a new version to production:** Deploy your code (e.g. push to main, Azure builds and deploys). Run any new migrations against the production database. For **routine** releases you do **not** run the wipe script—that would delete all production data. Preserve data by default.
- **When to run the wipe script:** Only when you intentionally need to clear all participants and their data—for example (1) **this major release:** replacing the old production app with this version and the schema/features have changed enough that a wipe is acceptable; (2) before a **first** production launch so production starts empty; or (3) a rare case where a full reset is the only option and migration is not possible. Always back up first. For future releases, prefer migration over wipe.

So: **two environments** = local (your machine, local DB, dev/test keys) and production (hosted app, production DB, production keys). **Smooth deployment** = deploy code + run migrations; **data policy** = preserve by default; wipe only for this major replacement or when migration is not possible.

---

## Deploy to production (script to run)

To deploy your code to production and test that it works:

1. **From the repo root, run:**
   ```bash
   ./scripts/deploy-to-azure.sh
   ```
   This commits any uncommitted changes (if you confirm), pushes to `main`, and triggers the **Deploy All** GitHub Action (Web + API). Watch the run in your repo’s **Actions** tab.

2. **First-time production setup:** If this is your first deploy, follow **`First_Time_Deploy.md`** first (Azure resources, GitHub secrets, run migrations on the **production** database). After that, the script above is all you need for each release.

3. **Local test data is not moved.** Production uses a **separate** database (e.g. Azure PostgreSQL). Your local DB stays as-is. So you do **not** need to run the wipe script for a normal deploy—production already has no local test data. Run the wipe script only if you want to clear **production** (or local) data on purpose.

4. **After each deploy:** If you added new migrations, run them against the production DB (see First_Time_Deploy or your run-migrations process). Then verify production, e.g.:
   ```bash
   PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
   ```
   (Use your Web App URL if different.)

---

## 1. Backup

- Back up the database before running the wipe script (e.g. `pg_dump` or your managed-DB backup).
- Keep the backup until you have verified the app and (if applicable) re-seeded or re-onboarded.

## 2. Environment

- Confirm production `.env` (or app settings):
  - No test/dev API keys; use production keys for OpenAI, Azure, Picovoice, etc.
  - Correct `DATABASE_URL` for the production database.
  - `APP_ENV` and `CORS_ALLOW_ORIGINS` set appropriately for production.
- If you use Azure Storage, ensure the production account and containers (photos, audio) are the intended ones.

## 3. Run the wipe script

The wipe script removes **all voice participants, users, people, moments, assets, voice stories, and related rows for the default family only**. It does not change schema or migrations.

From the API service directory:

```bash
cd services/api
uv run python scripts/wipe_all_participants_and_data.py --confirm
```

Without `--confirm`, the script exits without making changes.

## 4. After wipe

- Verify the app starts and shows an empty state (no voice stories, no participants).
- Optionally run smoke tests or a quick manual check of the voice flow and Shared Memories.

## 5. Production hardening (done as part of prep)

- The "Clear all recall codes (testing)" UI and the `POST /voice/participants/clear-all-recall-codes` endpoint have been removed so they are not exposed in production.
