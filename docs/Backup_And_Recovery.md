# Backup and recovery

LifeBook stores user content in **PostgreSQL** (Azure Flexible Server) and **Azure Blob Storage** (photos, audio). This doc describes what we back up, how to restore, and how to roll back after a bad release or migration.

---

## What we back up

| Store | Content | Backup method | Retention |
|-------|--------|---------------|-----------|
| **PostgreSQL** | Families, users, people, moments (stories, summaries, session_turns, reaction_log), assets (metadata + blob URLs), voice_stories, voice_participants (incl. voice profiles), transcripts, links | Azure automated backups; pre-release and optional daily `pg_dump`; optional upload to Azure Blob | Azure: 7 days (PITR); dumps: as long as you keep them (e.g. 30 days in blob) |
| **Azure Blob** | Photos container, audio container (uploaded photos/audio, narration BGM) | Azure redundancy (LRS/GRS) + **blob soft delete** (recommended) | Soft delete: e.g. 14 days |

---

## When to use which recovery

- **Undo the last hour or day (e.g. bad migration, accidental wipe):** Use **Azure Point-in-Time Restore (PITR)** or restore from your **pre-release dump** if you have one from just before the incident.
- **Restore to “yesterday” or a specific snapshot:** Use a **pg_dump** file (from `backup-db.sh` or the scheduled job) and `pg_restore`.
- **Revert app only (no DB change):** Redeploy the previous app version; no database restore.
- **Single blob deleted by mistake:** Restore from **blob soft delete** (if enabled).

---

## Database backup

### Pre-release backup (required before each release)

Before triggering a production release (and thus migrations), create a snapshot:

```bash
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/lifebook?sslmode=require'
./scripts/backup-db.sh
```

This creates `lifebook_backup_YYYYMMDD_HHMM.dump` in the repo root. Optionally set `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCOUNT_KEY` (and `AZURE_STORAGE_BACKUP_CONTAINER` if you use a different container name) to upload the dump to Azure Blob. Keep the dump at least until the release is verified.

### Scheduled daily backups (optional)

Use the GitHub Action **backup-db-scheduled.yml** (see [.github/workflows/backup-db-scheduled.yml](../.github/workflows/backup-db-scheduled.yml)) to run a daily backup and upload to Azure Blob. Requires GitHub secrets: `DATABASE_URL`, `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_ACCOUNT_KEY`. Optionally set `AZURE_STORAGE_BACKUP_CONTAINER` (default: `lifebook-db-backups`). Configure retention (e.g. keep last 30 days) in the storage account or with a lifecycle policy.

### Azure automated backups

Azure Database for PostgreSQL Flexible Server has **7-day backup retention** (see [scripts/azure-create-postgres.sh](../scripts/azure-create-postgres.sh)). Use these for point-in-time restore when you need to rewind to a specific time within the last week.

---

## Restore from a dump file

1. **Get the dump:** Use a local file from `backup-db.sh` or download from the Azure Blob backup container (e.g. `lifebook-db-backups`).

2. **Restore over the existing database** (destroys current data; use only when you intend to replace the DB):

   ```bash
   export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/lifebook?sslmode=require'
   # pg_restore expects postgresql:// for libpq
   RESTORE_URL="$DATABASE_URL"
   [[ "$RESTORE_URL" == postgresql+* ]] && RESTORE_URL="postgresql://${RESTORE_URL#*://}"
   pg_restore -d "$RESTORE_URL" --clean --if-exists -F c lifebook_backup_YYYYMMDD_HHMM.dump
   ```

   `--clean --if-exists` drops existing objects before recreating them. If the dump is from an older schema, ensure the target DB is either empty or you accept that some objects may fail to drop (e.g. if FKs differ). For a full replace, you can instead drop the database and recreate it, then restore without `--clean`.

3. **Restore to a different database** (e.g. staging):

   Create a new empty database in Azure (or use a staging URL), then:

   ```bash
   pg_restore -d "postgresql://USER:PASS@HOST:5432/lifebook_staging?sslmode=require" -F c lifebook_backup_YYYYMMDD_HHMM.dump
   ```

4. **Verify:** Run the app or a quick smoke test against the restored DB.

---

## Azure Point-in-Time Restore (PITR)

Use when you need to rewind the **production** database to a specific time within the last 7 days (e.g. right before a bad migration or accidental wipe).

1. In **Azure Portal**: go to your **PostgreSQL Flexible Server**.
2. Open **Backup** (or **Settings** → backup).
3. Use **Restore** / **Point-in-time restore**.
4. Choose the **restore point** (date/time). Azure will create a **new** server with the DB as of that time.
5. Update your app’s `DATABASE_URL` to point to the new server (or swap the server name if you prefer), or use the new server as a temporary copy to export data.

PITR creates a new server; it does not overwrite the current one. So you can compare or copy data back to the original server if needed.

---

## Blob storage: soft delete and restore

### Enable blob soft delete (recommended)

Soft delete keeps deleted or overwritten blobs recoverable for a set number of days. Enable it at the **storage account** level (it applies to all containers):

**Azure Portal:** Storage account → **Data management** → **Data protection** → enable **Soft delete for blobs**, set retention (e.g. 14 days).

**Azure CLI:**

```bash
az storage blob service-properties update \
  --account-name YOUR_STORAGE_ACCOUNT \
  --account-key YOUR_KEY \
  --enable-delete-retention true \
  --delete-retention-days 14
```

You can use the script: `AZURE_STORAGE_ACCOUNT=... AZURE_STORAGE_ACCOUNT_KEY=... ./scripts/azure-storage-backup-policy.sh`

### Restore a single blob from soft delete

- **Portal:** Storage account → **Containers** → select container → **Show deleted blobs**, find the blob, **Undelete**.
- **CLI:** Use `az storage blob undelete` with the blob name and container.

After undelete, the blob is live again; the app can access it via the same URL (if the blob name is unchanged).

### Future: backup container or second account

For cross-region or long-term blob backup, you can add a second container or storage account and a scheduled copy (e.g. `az storage blob copy start-batch` or Azure Data Factory). LifeBook does not implement this by default; Azure redundancy + soft delete is the baseline.

---

## Rollback playbook

### Revert app only (no DB restore)

Use when the new release is broken but the database is fine (e.g. bad frontend or API deploy).

1. In GitHub **Actions**, open the **Deploy All (Web + API)** (or Deploy API / Deploy Web) workflow.
2. Find the **last successful run** for the commit you want (e.g. previous version).
3. Re-run that workflow from that commit, or redeploy the previous container image/version via Azure.
4. Verify production; no database steps.

### Revert app + DB (e.g. bad migration)

Use when a migration has already run and you need to go back to the previous schema and data.

1. **Restore the database** to a state from before the migration:
   - **Option A:** Restore from your **pre-release dump** (from `backup-db.sh`) using `pg_restore` (see [Restore from a dump file](#restore-from-a-dump-file)).
   - **Option B:** Use **Azure PITR** to restore to a point in time just before the migration (creates a new server; then point the app to it or copy data back).
2. **Redeploy the previous app version** (the one that matches the restored schema): re-run the deploy workflow from the previous commit, or deploy the previous container image.
3. Verify production.

**Warning:** If the migration was not backward-compatible (e.g. dropped a column), restoring an older dump and then running the old app is correct. If you restore an old dump and then run the *new* app, the app may expect the new schema and fail. Always pair DB restore with the app version that matches that schema.

---

## Operational safeguards

- **Wipe / clear scripts:** The scripts [wipe_all_participants_and_data.py](../services/api/scripts/wipe_all_participants_and_data.py) and [clear_shared_memories.py](../services/api/scripts/clear_shared_memories.py) can remove large amounts of data. If `DATABASE_URL` points at production (e.g. contains `database.azure.com`), the scripts require an explicit confirmation flag or `LIFEBOOK_ALLOW_PROD_WIPE=1` so you don’t run them against prod by mistake. Always take a backup before running any wipe.
- **Pre-release backup:** Treat it as mandatory. Run `./scripts/backup-db.sh` before every production release and keep the dump until the release is verified.

---

## Restore testing

Once per quarter (or after a major infra change), test that you can recover from a backup:

1. Download a recent dump from your backup location (or use a recent local dump).
2. Restore it to a **staging or temporary** database (not production) using `pg_restore`.
3. Point a staging app instance at that DB (or run a quick script) and run a short smoke test (e.g. load a moment, check assets).
4. Document any issues (e.g. missing secrets, wrong URL format) so the real restore runbook stays accurate.

This confirms that your backup and restore procedure works end-to-end.
