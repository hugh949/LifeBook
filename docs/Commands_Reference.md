# Commands reference (when to run what)

Single place for the commands you need. Uses full paths so you can run from any directory. **This file is kept updated when we add or change scripts.**

---

## Run the app

```bash
cd /Users/hughrashid/Cursor/LifeBook && docker compose up --build
```

Or from repo root: `./scripts/run-local.sh`  
Then open http://localhost:3000

**If you changed the web or API code but don’t see it:** Restart with `--build` (as above) so the container uses the new image, then hard-refresh the browser (Cmd+Shift+R or Ctrl+Shift+R).

---

## Run database migrations

Use this when you’ve pulled new code that has migrations (e.g. new Eagle columns) or before first run. Runs inside Docker so `DATABASE_URL` host `db` resolves.

```bash
cd /Users/hughrashid/Cursor/LifeBook && docker compose run --rm api alembic upgrade head
```

Or from repo root: `./scripts/run-migrations.sh`

---

## Test Voice ID (Eagle)

Checks that Picovoice Eagle is configured and the library works. Needs `PICOVOICE_ACCESS_KEY` in root `.env` and `pveagle` installed in the Python env you use (`pip install pveagle` if needed).

```bash
python /Users/hughrashid/Cursor/LifeBook/services/api/scripts/test_speaker_recognition.py
```

(Eagle is the default backend; with Azure keys set, use `VOICE_ID_BACKEND=azure` before the command to test Azure instead.)

---

## Optional: run API or web without Docker

See README “Optional: run API + web on your machine”. You’d run Postgres with Docker, then API and/or web locally; not needed for normal dev with `docker compose up`.

---

## Deploy to Azure

From repo root: `./scripts/deploy-to-azure.sh`  
See `First_Time_Deploy.md` and `scripts/README.md`.

---

*When adding or changing runnable scripts or workflows, update this file so it stays the single reference for “which command to run when”.*
