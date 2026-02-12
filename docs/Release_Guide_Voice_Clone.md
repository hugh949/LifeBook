# Production Release Guide — Voice Clone & Narration

Use this guide to release the voice cloning and narration improvements to production **carefully**.

---

## Pre-release checklist

### 1. Commit everything

```bash
cd /Users/hughrashid/Cursor/LifeBook
git status
git add -A
git commit -m "Voice clone: 1min audio, ElevenLabs tips, verify script, narration fixes"
```

The release script **requires** a clean working tree. Uncommitted changes will cause it to fail.

### 2. Verify ELEVENLABS_API_KEY in GitHub Secrets

**Voice cloning and narration BGM** require `ELEVENLABS_API_KEY` in production.

- Go to your repo: **Settings → Secrets and variables → Actions**
- Confirm **`ELEVENLABS_API_KEY`** exists. If missing, add it (from [ElevenLabs](https://elevenlabs.io)).
- Without it: narration will use OpenAI default voice only; BGM will be disabled.

### 3. Run pre-release check (optional)

```bash
./scripts/check-deploy-ready.sh --require-clean
```

Must pass (no uncommitted changes, deploy config OK).

---

## Migration 016 (elevenlabs_voice_id)

This release includes migration **016_elevenlabs_voice_id.py**, which adds:

- `elevenlabs_voice_id` and `elevenlabs_voice_consent_at` to `voice_participants`

**Migrations run automatically** when the Deploy API workflow runs, **if** `DATABASE_URL` is set in GitHub Secrets. No manual step needed unless you run migrations separately.

---

## Release steps (in order)

### Step 1: Set production DATABASE_URL (for backup and migrations)

In a **dedicated terminal**, set the production Postgres URL:

```bash
export DATABASE_URL='postgresql+psycopg://USER:PASSWORD@YOUR-SERVER.postgres.database.azure.com:5432/lifebook'
```

Get this from Azure Portal → PostgreSQL → Connection strings (or your password manager).

---

### Step 2: (Recommended) Back up production DB

```bash
cd /Users/hughrashid/Cursor/LifeBook
pg_dump "$DATABASE_URL" -F c -f lifebook_prod_backup_$(date +%Y%m%d_%H%M).dump
```

Or use Azure Portal → PostgreSQL → Backup.

---

### Step 3: Run migrations on production (if not using GitHub Secrets)

If `DATABASE_URL` is **not** in GitHub Secrets, run migrations manually **before** deploy:

```bash
cd /Users/hughrashid/Cursor/LifeBook
./scripts/prod-migrations.sh
```

If `DATABASE_URL` **is** in GitHub Secrets, the Deploy API workflow runs migrations automatically. You can still run them manually before deploy for extra safety.

---

### Step 4: **Do NOT run the wipe script**

This is a **routine release**. Per `Prep_for_Production.md`, **preserve data**. Do not run `wipe_all_participants_and_data.py`.

---

### Step 5: Run the release script

```bash
cd /Users/hughrashid/Cursor/LifeBook
./scripts/release.sh
```

- Choose: deploy current version (1.3) as-is, or bump minor (e.g. 1.4).
- Confirm backup and migrations when prompted (if `DATABASE_URL` is set).
- Script commits (if version changed), pushes to `main`, and triggers **Deploy All (Web + API)**.
- If you don't have `gh` installed: after push, go to **GitHub → Actions → Deploy All (Web + API) → Run workflow**.

---

### Step 6: Wait for the workflow

- GitHub Actions → **Deploy All (Web + API)** should turn green (~5–15 min).
- Both **Deploy Web** and **Deploy API** jobs must succeed.

---

### Step 7: Verify production

```bash
cd /Users/hughrashid/Cursor/LifeBook
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

Optional: confirm deployed version:

```bash
EXPECTED_VERSION=1.3 PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

---

### Step 8: Manual smoke test

1. Open your production Web App URL.
2. Check nav shows correct version (e.g. **v1.3**).
3. Try: **Create Memories** → Talk → clone voice (1 min) → save story → **Shared Memories** → **Narrate Story**.
4. Confirm "Your voice" appears when narration uses the cloned voice.

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `./scripts/release.sh` | Full release: version, commit, push, trigger Deploy All |
| `./scripts/prod-migrations.sh` | Run migrations on production DB (set `DATABASE_URL` first) |
| `./scripts/verify-prod.sh` | Verify production proxy and API health |
| `./scripts/check-deploy-ready.sh --require-clean` | Pre-release check (no uncommitted changes) |

**Diagnostic (local/Docker only):**

```bash
docker compose run --rm api python /app/scripts/verify_voice_clone_narration.py --name Harry
```

---

## If something fails

- **Migrate fails:** Check `DATABASE_URL`, firewall (Azure Postgres → Networking), and SSL (`sslmode=require`).
- **Deploy fails:** Check GitHub Actions logs; ensure `AZURE_CREDENTIALS` or `AZURE_CLIENT_*` secrets are set.
- **Narration uses default voice:** Ensure `ELEVENLABS_API_KEY` is in GitHub Secrets and was present when the workflow ran.
- **404 on new routes:** See `Deployment_Pitfalls_and_Learnings.md` — often traffic is on an old revision; run `az containerapp ingress traffic set --revision-weight latest=100`.
