# LifeBook

A private, voice-first memory keeper. Talk with a trusted companion to elicit
memories, shape them into stories worth keeping, and listen privately in your
own voice. Everything stays yours until you **explicitly** create a password-protected
share link. See [docs/Five_Agent_Architecture.md](docs/Five_Agent_Architecture.md).

Built to **run locally first**, then deploy to **Azure** when you want to share
with others.

**Azure cost (pilot):** API Container App scales to zero (`minReplicas=0`). See [docs/AZURE_COST_PILOT.md](docs/AZURE_COST_PILOT.md).

---

## Run locally (one command)

**You need:** Docker and Docker Compose.

```bash
# 1. Clone and go to repo root
cd LifeBook

# 2. Create env (no secrets required for local sign-in / sign-up)
cp .env.example .env
# One .env at root for local; same keys go to Azure for production.
# See docs/Env_Files_Where_to_Edit.md.

# 3. Start everything
docker compose up --build
```

See **`docs/Commands_Reference.md`** for related commands (migrations, etc.).

Open **http://localhost:3000**. The API is at `http://localhost:8000`
(health: `/health`).

First visit will land on `/signin` &mdash; follow the link to **Create an
account**. After that:

- **Talk**: `/talk` &ndash; conversation companion (and storyteller handoff) that saves privately.
- **Library**: `/library` &ndash; your private conversations and stories; filter Private / Shared.
- **Me**: `/me` &ndash; voice, avatar, and preferences for *your* narrations.
- **Shared link (recipient view)**: `/s/<token>` &ndash; password required to unlock; no account needed.

No Azure or OpenAI keys are required to sign up and browse locally. For voice
conversations, narration, and pencil-sketch avatars, add these keys to `.env`:

- `OPENAI_API_KEY` &ndash; Realtime voice, per-agent text brains, default TTS fallback, and
  `gpt-image-1` pencil-sketch stylization. Optional per-agent model overrides are listed in
  `.env.example` and `docs/Five_Agent_Architecture.md`.
- `ELEVENLABS_API_KEY` &ndash; voice cloning and narration with the user's
  cloned voice.
- `AZURE_STORAGE_*` &ndash; audio and photo blob storage. If unset, uploads
  fall back to a local stub.

**Local validation:** After starting, confirm (1) the app loads at
http://localhost:3000, (2) you can sign up and reach `/talk`, and (3)
`http://localhost:3000/api/proxy-ping` returns 200 JSON with `"proxy": true`.

---

## Iterate quickly (dev with hot reload)

Use the same stack; the `docker-compose.override.yml` mounts your code so the
API and web app live-reload on save.

```bash
docker compose up --build
```

---

## When you want feedback from others &rarr; Azure

**First time?** Use **`First_Time_Deploy.md`** &ndash; a step-by-step checklist
(create resources in West US 3, set GitHub secrets, first deploy, run
migrations). Do it once.

**After that:** Deployments are driven by **GitHub**. Push to `main` and the
workflows build and deploy for you.

- **One command:** Run **`./scripts/deploy-to-azure.sh`** to commit (if needed),
  push to `main`, and get the link to watch the Azure workflow.
- **Automatic:** Push to `main` &rarr; **Deploy All** runs. Path-specific pushes
  run only **Deploy Web** or **Deploy API** when appropriate.
- **Manual:** **Actions** &rarr; **Deploy Web** / **Deploy API** / **Deploy
  All** &rarr; **Run workflow**.

**Production checklist:** set `SESSION_SECRET` to a long random value
(`python -c "import secrets; print(secrets.token_urlsafe(64))"`) in Azure
Configuration before signing anyone up. Changing it later signs every
user out. Full reference: **`Azure_Deployment_Appendix.md`**.

---

## Core features

LifeBook is a **personal, private** memory app. Every conversation and story is
private to the user who recorded it; nothing is visible to anyone else unless
the owner creates a share link.

- **Accounts**: email + password sign-up, HS256 JWT session cookie. Forgot
  password via `/forgot-password` (SMTP optional; local returns a clickable
  `dev_reset_url`). Replace `SESSION_SECRET` before production.
- **Talk**: live voice session with specialist companions (Conversation &rarr;
  Storyteller) via the OpenAI Realtime API. Stories save privately to Library.
- **Library**: browse private conversations and stories; listen privately;
  continue refining; manage password-protected share links.
- **Voice clone (Me &rarr; Voice)**: record 60&ndash;90 seconds (re-record to
  improve) and ElevenLabs creates a cloned voice for your narrations.
- **Pencil-sketch avatar (Me &rarr; Avatar)**: upload a selfie; `gpt-image-1`
  stylizes it to a friendly pencil-sketch portrait for narrations.
- **Sharing**: create a password-protected link when you are ready. Change the
  password or remove access anytime. Recipients unlock at `/s/<token>` and may
  leave a note. No recipient sign-up required.

See **`docs/Five_Agent_Architecture.md`** and
**`docs/Personal_Rearchitecture_Notes.md`** for how the pieces fit together.

---

## Docs

| Doc | Purpose |
|-----|---------|
| **`docs/Five_Agent_Architecture.md`** | Trusted-friend five-agent model + privacy rules |
| **`First_Time_Deploy.md`** | First-time Azure deploy checklist + iterating |
| **`docs/Commands_Reference.md`** | Migrations, local helpers, one-offs |
| **`docs/Env_Files_Where_to_Edit.md`** | Which `.env` to edit (root vs services/api vs web) |
| **`docs/Personal_Rearchitecture_Notes.md`** | New data model, auth, sharing |
| `Azure_Deployment_Appendix.md` | Full Azure reference (secrets, Key Vault, hardening) |

---

## Optional: run API + web without Docker

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

Then open http://localhost:3000. The web app uses `/api`, which the runtime
proxy forwards to `API_UPSTREAM` (default `http://localhost:8000`).

---

## License

TBD
