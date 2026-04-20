# LifeBook

A private, voice-first memory keeper. Sign up, record conversations, turn them
into stories, and share specific memories with whoever you want &mdash; narrated
in your own cloned voice by a pencil-sketch portrait of yourself. Everything
stays private until you explicitly share it.

Built to **run locally first**, then deploy to **Azure** when you want to share
with others.

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

- **Talk**: `/talk` &ndash; record a new conversation with the AI companion.
- **Library**: `/library` &ndash; review private conversations and stories.
- **Me**: `/me` &ndash; set up your voice clone and pencil-sketch avatar, or
  sign out.
- **Shared link (recipient view)**: `/s/<token>` &ndash; anyone with the link can
  listen and leave a note; no account needed. If the sender attached a 4-digit
  code, the recipient enters it here.

No Azure or OpenAI keys are required to sign up and browse locally. For voice
conversations, narration, and pencil-sketch avatars, add these keys to `.env`:

- `OPENAI_API_KEY` &ndash; Realtime voice agent, default TTS fallback, and
  `gpt-image-1` pencil-sketch stylization.
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

- **Accounts**: email + password sign-up, HS256 JWT session cookie. Replace the
  secret in `.env`/`SESSION_SECRET` before production.
- **Talk**: live voice session with an AI companion via the OpenAI Realtime
  API. At any point the companion can snapshot the conversation into a titled
  Story with a short summary.
- **Library**: browse and play private conversations and stories; delete or
  continue refining them; see all comments received across share links.
- **Voice clone (Me &rarr; Voice)**: record 60&ndash;90 seconds once and
  ElevenLabs creates a cloned voice used for shared narration.
- **Pencil-sketch avatar (Me &rarr; Avatar)**: upload a selfie; `gpt-image-1`
  stylizes it to a friendly pencil-sketch portrait. The portrait animates a
  simple open/closed mouth in time with the narration audio.
- **Sharing**: create a link for any single conversation or story. Optionally
  attach a 4-digit code. Recipients open `/s/<token>`, unlock with the code if
  required, listen to the narration, and leave a named comment the owner can
  read in their Library. No recipient sign-up required.

See **`docs/Personal_Rearchitecture_Notes.md`** for the data model and
how the pieces fit together.

---

## Docs

| Doc | Purpose |
|-----|---------|
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
