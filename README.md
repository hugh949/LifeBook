# LifeBook MVP

Voice-first, multimodal family memory bank: photos, voice, and a digital memory timeline. Built to **run locally first**, then deploy to **Azure** when you want to share with others.

---

## Run locally (one command)

**You need:** Docker and Docker Compose.

```bash
# 1. Clone and go to repo root
cd LifeBook

# 2. Create env (no secrets required for local)
cp .env.example .env

# 3. Start everything
docker compose up --build
```

Then open **http://localhost:3000**. The API is at http://localhost:8000 (health: http://localhost:8000/health).

- **Upload a photo:** [Family → Upload](http://localhost:3000/family/upload)
- **See moments:** [Memory Bank](http://localhost:3000/bank)
- **Older mode / Talk:** [Older Mode](http://localhost:3000/older) (voice is stubbed until you add an OpenAI key)

No Azure or OpenAI keys are required for this. Uploads use a local stub; Realtime voice returns a “stubbed” message until you set `OPENAI_API_KEY` in `.env`.

---

## Iterate quickly (dev with hot reload)

Use the same stack but mount your code so changes apply without rebuilding:

```bash
docker compose up --build
```

If you have a `docker-compose.override.yml` in the repo (see below), the API and web app will run with **live reload**: edit files and refresh (or wait for the process to restart).

---

## When you want feedback from others → Azure

**First time?** Use **`First_Time_Deploy.md`** — a step-by-step checklist (create resources in West US 3, set GitHub secrets, first deploy, run migrations). Do it once.

**After that:** Deployments are driven by **GitHub**. Push to `main` and the workflows build and deploy for you. No need to redeploy from your machine or the Azure Portal for routine releases.

- **Automatic:** Push to `main` → **Deploy All** runs (web + API). Path-specific pushes run only **Deploy Web** or **Deploy API** when only that app changed.
- **Manual:** **Actions** → **Deploy Web** / **Deploy API** / **Deploy All** → **Run workflow**.

Many iterations with early adopters: change code → push → GitHub deploys. Same Azure resources and secrets; only code and config (env vars) when you add new features. Full reference: **`Azure_Deployment_Appendix.md`** (§ 11 GitHub Actions, § 12 production hardening).

---

## Core features (discovery phase)

Right now the product is in **discovery**: we’re figuring out which features people find useful. Expect changes.

**Currently in the MVP:**

- One default “family” (no auth yet).
- Family upload: photo → Azure Blob (or stub) → moment in the bank.
- Memory bank: list of moments with thumbnails, link to moment detail.
- Moment detail: photo(s), story/comments, **past recordings** (audio + transcripts when saved).
- Older mode: Talk (Realtime when OpenAI key set), Memory Trailer placeholder.
- Shareable moment page: `/m/[momentId]`.

**Shared memory:** Stories, voice recordings, past recordings, photos, and comments are **preserved in Azure** (Postgres + Blob) so the family’s memory is durable and replayable. See **`docs/Data_Preservation_Shared_Memory.md`**.

**Planned after feedback:** Auth, full post-session transcript pipeline, Memory Trailer, and whatever proves most valuable from user feedback.

---

## Docs

| Doc | Purpose |
|-----|--------|
| **`First_Time_Deploy.md`** | **First-time Azure deploy checklist + iterating** |
| **`docs/Data_Preservation_Shared_Memory.md`** | **How stories, voice, photos & transcripts are preserved in Azure** |
| `Azure_Deployment_Appendix.md` | Full Azure reference (secrets, Key Vault, hardening) |
| `V1_Product_Spec.md` | MVP scope and behaviour |
| `Product_Vision_Roadmap.md` | Short / medium / long-term vision |
| `MVP_TODO.md` | Technical task list |

---

## Optional: run API + web on your machine (no Docker for app code)

If you prefer to run the API and Next.js locally and only use Docker for Postgres:

```bash
# Terminal 1: Postgres only
docker compose up db

# Terminal 2: API (from repo root)
cp .env.example .env
# In .env set: DATABASE_URL=postgresql://lifebook:lifebook@localhost:5432/lifebook
cd services/api && pip install . && alembic upgrade head && uvicorn app.main:app --reload --port 8000

# Terminal 3: Web
cd apps/web && npm install && npm run dev
```

Then open http://localhost:3000. The app uses `/api`, which Next rewrites to `http://localhost:8000` by default.

---

## License

TBD
