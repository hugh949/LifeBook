# Where to put env vars: which .env to edit

LifeBook uses env vars in a few places. Here’s how they relate so you only update what you need.

---

## Simplest way (local dev + Azure production)

Use **one mental model**:

1. **Local:** One file — **`.env` at repo root** (copy from `.env.example`). Fill in only the keys you need for the features you’re testing. Docker and API scripts use this.
2. **Checklist:** **`.env.example`** is the single list of every key. When you add a new feature that needs a key, add it to `.env.example` first (with a short comment), then add the value to your local `.env` and, when you’re ready to ship, to Azure.
3. **Production (Azure):** Add the same keys in **Azure** (Container App → Configuration for the API; Web App → Configuration for the web app; or GitHub Actions secrets so the deploy workflow passes them). You do this once per key when you enable a feature in production.

So: **local = one root `.env`**; **production = same keys in Azure (or GitHub secrets)**. All keys live in the root `.env` only; scripts and Alembic load that file only.

**When you add a new key (e.g. for a new feature):**

| Step | Where |
|------|--------|
| 1. Document it | Add a line (and comment) to **`.env.example`** at repo root. |
| 2. Use it locally | Add the value to your **root `.env`** (or leave empty if the feature is optional). |
| 3. Use it in production | Add the variable (and secret value) to **Azure** Container App or Web App configuration, or as a **GitHub secret** if the deploy workflow is set up to pass it. See `First_Time_Deploy.md` for API env vars and GitHub secrets. |

That way you never wonder “where does this key go?” — it’s always: in `.env.example`, in your local `.env`, and in Azure (or secrets) for production.

---

## TL;DR

| How you run the app | File to edit | Notes |
|---------------------|--------------|--------|
| **Docker Compose** (`docker compose up`) | **Repo root** `.env` | Only this file is loaded for the API (and DB URL is overridden in `docker-compose.yml`). |
| **API scripts / Alembic** | **Repo root** `.env` only | Scripts and Alembic load only root `.env`. Run scripts with the full path so you don't depend on current directory, e.g. `python /path/to/LifeBook/services/api/scripts/test_speaker_recognition.py`. |
| **Web app locally** (`npm run dev` in `apps/web`) | **`apps/web/.env.local`** | Next.js convention; copy from `apps/web/.env.local.example`. Use for `API_UPSTREAM` when talking to the API. |

**Recommendation:** For most setups, use **one** file: copy `.env.example` to **`.env` at the repo root** and put your keys there. Use that for Docker and for any API work. Only add `apps/web/.env.local` if you run the web app outside Docker and need to point it at a different API.

---

## How each file is used

### 1. Repo root: `.env`

- **Docker Compose:** The **api** service has `env_file: - ./.env`, so every variable in root `.env` is passed into the API container. The **web** service does not use this file; its env is set in `docker-compose.yml`.
- **API when run outside Docker:** The FastAPI app does not load any `.env` itself; it only reads `os.environ`. So you must either export vars in your shell or run from an environment that has already loaded root `.env` (e.g. your IDE or a wrapper script).
- **Scripts in `services/api/scripts/`** and **Alembic** load `.env` via `python-dotenv` from **repo root only**. Use the full path to the script when you run it so the current directory doesn't matter (e.g. `python /path/to/LifeBook/services/api/scripts/test_speaker_recognition.py`).

- **Migrations:** If your `DATABASE_URL` uses host `db` (Docker service name), that only resolves **inside** containers. To run migrations from your machine, either run them inside the API container (`docker compose run --rm api alembic upgrade head` from repo root) or use a `DATABASE_URL` with `localhost` when Postgres is exposed on 5432 (e.g. `docker compose up db` then `DATABASE_URL=postgresql://lifebook:lifebook@localhost:5432/lifebook?sslmode=disable alembic -c services/api/alembic.ini upgrade head` from repo root).

**Create it from:** `cp .env.example .env` at the repo root.

---

### 2. Web app: `apps/web/.env.local`

- **Used by Next.js** when you run the web app (e.g. `npm run dev` or a production build). Next.js loads `.env`, `.env.local`, `.env.development`, etc. from **`apps/web/`**.
- **Not used by Docker Compose.** The web container gets its env from `docker-compose.yml` (e.g. `NEXT_PUBLIC_API_BASE_URL`, `API_UPSTREAM`), not from a file in the repo.

Use `apps/web/.env.local` when you run the web app **outside** Docker and need to set things like `API_UPSTREAM` (e.g. to `http://localhost:8000`).

**Create it from:** `cp apps/web/.env.local.example apps/web/.env.local`.

---

## Summary

- **One place for Docker + API + scripts + Alembic:** repo root **`.env`** (from `.env.example`). All keys live there; scripts and Alembic load only this file.
- **Web when not using Docker:** **`apps/web/.env.local`** (from `.env.local.example`) for Next.js and `API_UPSTREAM`.

All of these files (`.env`, `.env.local`) are in `.gitignore`; only the `.example` files are committed.
