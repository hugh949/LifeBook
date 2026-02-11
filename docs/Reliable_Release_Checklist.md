# Reliable release checklist — avoid production-only errors

Use this so **only committed code** is deployed and production runs the **exact same image** you built. Past issues (uncommitted code, wrong checkout ref, stale Docker cache, traffic on old revision, missing secrets) are guarded by the steps below.

---

## Aggressive parity (code + image)

To maximize confidence that production matches local:

1. **Commit** — Nothing is deployable until committed. `release.sh` runs `check-deploy-ready.sh --require-clean` and **fails** if there are uncommitted changes.
2. **Push** — After `git push`, the release script **verifies** that `origin/main` equals your local `HEAD`. If not, the script exits so you don’t trigger a deploy from the wrong commit.
3. **Build** — The deploy workflow checks out **the commit that triggered the run** (`ref: ${{ github.sha }}`), builds the Docker image with **`--no-cache`** and **`BUILD_SHA=${{ github.sha }}`** baked into the image, and has a **source verification** step that greps for critical routes (delete, narrate/bgm, ElevenLabs) so the build fails if that code is missing.
4. **Deploy** — After updating the Container App, the workflow **routes 100% traffic to the latest revision** and then **verifies** that production `/health` returns `build_sha` equal to `github.sha`. If the running API reports a different commit, the workflow **fails**.

So: same commit → same build → same image → verified at runtime. If any step fails, fix it before considering the release done.

---

## Golden rule: **Commit first, release second**

The release script **fails** if you have uncommitted changes. You must commit (and optionally push) everything you want in production, then run the release. That way production never runs code that “only worked on your machine” because it was never committed.

---

## Step-by-step: smooth next release

Do this from the **LifeBook repo root**.

### 1. Test locally

```bash
./scripts/run-local.sh
# Or: docker compose up --build
```

- Open http://localhost:3000 and test the flows you care about (e.g. Narrate Story, Shared Memories, Talk).
- Confirm the version in the UI (e.g. **LifeBook v1.0**) matches what you expect.

### 2. Commit everything you want in production

```bash
git status
git add -A
git commit -m "Describe your changes"
```

If you leave anything uncommitted, step 3 will **fail** on purpose.

### 3. (Optional) Run pre-release check alone

```bash
./scripts/check-deploy-ready.sh --require-clean
```

- **Pass:** No uncommitted changes; deploy config and routes look good.
- **Fail:** Fix what it reports (usually: commit your changes, or fix workflow/Dockerfile/route checks). Then run again.

### 4. Run the release

```bash
./scripts/release.sh
```

- The script runs `check-deploy-ready.sh --require-clean` again. If you have uncommitted changes, it exits with a clear message; commit and run `release.sh` again.
- Choose: deploy current version as-is, or bump minor (e.g. 1.0 → 1.1).
- Script pushes to `origin main` and triggers **Deploy All (Web + API)** (if `gh` is installed).
- If you don’t have `gh`, go to GitHub → Actions → **Deploy All (Web + API)** → **Run workflow**.

### 5. Wait for the workflow

- In GitHub: **Actions** → wait until **Deploy All (Web + API)** is green (~5–15 min).

### 6. Verify production

```bash
PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

Optional: confirm the deployed version matches the release:

```bash
EXPECTED_VERSION=1.1 PROD_WEB_URL=https://app-lifebook-web-v1.azurewebsites.net ./scripts/verify-prod.sh
```

### 7. Quick check in the browser

- Open your production Web App URL.
- Check the nav shows the same version (e.g. **v1.1**).
- Try one critical path (e.g. Narrate Story or Shared Memories).

---

## Env vars: production must have what you use locally

If you added or use features that need new keys, add those **same keys** to production **before** or right after deploy, or the feature will fail only in production.

| Env var | Used for | Where to set (production) |
|--------|----------|----------------------------|
| `OPENAI_API_KEY` | Talk, Narrate TTS, music prompt | Container App (API) / GitHub secret |
| `OPENAI_TEXT_MODEL` | Optional model override | Container App (API) |
| `ELEVENLABS_API_KEY` | Narrate Story BGM (ElevenLabs Music) | **Must be in GitHub Secrets** and is passed by deploy-api workflow to the Container App. If missing, BGM returns `url: null` in production. |
| `PICOVOICE_ACCESS_KEY` | Voice ID (Eagle) | Container App (API) |
| `AZURE_STORAGE_ACCOUNT` / `AZURE_STORAGE_ACCOUNT_KEY` | Uploads, photos, BGM storage | Container App (API) |
| `DATABASE_URL` | Postgres | Container App (API) / GitHub secret |

- **Checklist:** Compare your **root `.env`** (or `.env.example`) with the variables configured on the **Azure Container App** (API) and **GitHub Secrets** used by the deploy workflow. Any key you rely on locally for this release should exist in production with the same name.

See **docs/Env_Files_Where_to_Edit.md** and **First_Time_Deploy.md** for where to add secrets in Azure and GitHub.

---

## If something goes wrong after deploy

### New route returns 404 in production

1. **Traffic still on old revision:**  
   Route traffic to the new revision:
   ```bash
   az containerapp ingress traffic set -n aca-lifebook-api-v1 -g rg-lifebook-v1 --revision-weight latest=100
   ```
2. **Workflow used wrong commit:**  
   See **Deployment_Pitfalls_and_Learnings.md** (§ 2–3): checkout must pin `ref: ${{ github.sha }}`; build should use `--no-cache` and `BUILD_SHA`.
3. **OpenAPI check:**  
   `curl -s "https://YOUR-API-URL/openapi.json" | python3 -c "import json,sys; d=json.load(sys.stdin); print(list(d.get('paths',{}).keys()))"`  
   If your route is missing, the running image doesn’t have your code — re-run deploy and ensure traffic is on `latest`.

### Verify script fails (proxy, health, or version)

- Check **Azure Web App** and **Container App** logs.
- Confirm **API_UPSTREAM** on the Web App is the API **base URL only** (no `/api` path). See **Deployment_Pitfalls_and_Learnings.md** (§ 5).

### Migrations

If this release includes DB changes, run migrations against the **production** database **before** or right after deploy (see **Production_Release_Steps.md**). Set `DATABASE_URL` to the production Postgres URL, then:

```bash
./scripts/prod-migrations.sh
```

---

## One-command summary

After you’ve **committed everything** and tested locally:

```bash
./scripts/release.sh
```

Then wait for the workflow, run `verify-prod.sh`, and check the app in the browser. For more detail, use **Release_Process.md** and **Deployment_Pitfalls_and_Learnings.md**.
