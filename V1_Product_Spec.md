# V1 Product Spec — LifeBook Multimodal Family Memory Bank (Voice-First, Azure Option B)

## 0) Goal

Build a **voice-first, multimedia reminiscence web app** that works beautifully on **mobile, tablet, and desktop**, enabling:
- Older adults to enjoy short, emotionally engaging **Memory Trailers** and simple voice prompts.
- Children/grandchildren to contribute **photos + voice notes** easily.
- A structured **Digital Memory Bank** that can be searched, replayed, and repurposed into future family stories.

**V1 priority:** fastest prototype that is demoable and shareable (local → Azure).

**Language support (V1):** English, Cantonese, Mandarin, Spanish, Urdu  
**Language UX:** auto-detect + lock per session + manual override.

---

## 1) V1 Scope Summary

### Included
- Voice companion session (OpenAI Realtime) with multilingual auto-detect
- “Memory Trailer + One Question” daily micro-session
- Family contribution: upload photo + optional voice note
- Digital Memory Bank: timeline feed + people directory + moment detail
- SSR share pages (Option B) for moments and invites
- Azure-ready storage + DB + secrets

### Excluded (V1)
- Complex video ingestion & smart clipping (photos only in trailers)
- Live multi-user co-watching
- Advanced permissions beyond family group roles
- “Medical” features: screening, diagnosis, depression scoring
- Full LifeBook PDF export (later)

---

## 2) Users & Roles

### Personas
1) **Older Adult** — lean-back experience, low cognitive load
2) **Family Member** — contributor/creator
3) **Curator** (optional V1) — organizes / edits moments

### Roles
- `older_adult`
- `family_member`
- `curator` (optional V1; can be same as family_member)

---

## 3) UX Modes & Core Flows

### Mode A — Older Mode (Lean-back)
Primary flow:
1. Tap **Play Memory Trailer**
2. Watch 20–60s montage (photos + music + captions)
3. Assistant asks **one** friendly prompt
4. User answers by voice
5. Moment saved + family notified (optional)

Key buttons (big):
- Play Trailer
- Talk
- Family Messages (plays latest voice notes)
- Switch Language
- Calm Mode (Music-only)

### Mode B — Family Mode (Creator)
Primary flow:
1. Upload a photo (required)
2. Optional: record voice note (10–30s) asking a question or sharing a memory
3. Optional: tag person(s) / relationship
4. Submit → app generates caption suggestions + tags → content becomes part of memory bank

---

## 4) Multilingual Behavior

### Language selection
- Default: **Auto**
- Manual: English / Cantonese / Mandarin / Spanish / Urdu

### Auto-detect + lock
- Detect language from **first finalized transcript** (not partials).
- If confident → set `session_language` and lock.
- If uncertain → ask a short confirmation in detected language + English.
- Always provide: “Switch Language” manual override.

### Storage policy
For each voice note / session:
- `transcript_original` (detected language)
- `transcript_en` (English translation for indexing) — recommended in V1
- `language_code` (e.g., `en`, `zh-yue`, `zh`, `es`, `ur`)

**Cantonese vs Mandarin:** treat separately (don’t lump as “Chinese”).

---

## 5) V1 Screen / Route Map (SSR-Heavy)

### Routes (Next.js)
- `/` — landing + choose mode (Older / Family) + language selector
- `/older` — older home (SSR-lite)
- `/older/session` — talk + prompt session (client audio loop)
- `/family` — family dashboard
- `/family/upload` — photo + voice note upload
- `/bank` — memory bank timeline + people directory
- `/m/[momentId]` — **Moment share page (SSR)**
- `/p/[personId]` — person page (SSR)
- `/invite/[token]` — join family flow (SSR)

SSR pages:
- Moment share: `/m/[momentId]`
- Invite: `/invite/[token]`
- Person: `/p/[personId]` (optional SSR in V1; can be SSR-lite)

---

## 6) “Memory Trailer” (V1 Implementation)

### V1 Choice: Client-side trailer rendering (fastest)
- Trailer is a **renderable config**, not necessarily a stored MP4.
- Uses 3–8 photos, gentle transitions, captions overlay, background music track.

Store:
- `trailer_config.json` (photo asset IDs + caption strings + music track ID)
- Optionally render to MP4 later (post-V1).

### Trailer rules for older adults
- Slow pacing
- Big captions, high contrast
- Autoplay with Pause/Replay
- Volume ducking when assistant speaks

---

## 7) Content Units & Data Model (V1)

### Core units
- **Asset**: photo/audio
- **Moment**: a reminiscence unit (title, summary, tags, linked assets)
- **Person**: a person in the family memory bank
- **Transcript**: transcripts tied to audio assets

### Postgres tables (recommended)
**Family**
- `id`, `name`, `created_at`

**User**
- `id`, `family_id`, `role`, `display_name`, `email`, `preferred_language`, `created_at`

**Person**
- `id`, `family_id`, `display_name`, `relationship`, `language_names_json`, `created_at`

**Asset**
- `id`, `family_id`, `type` (`photo|audio`), `blob_url`, `thumb_url`, `duration_sec`,
  `created_by_user_id`, `created_at`, `metadata_json`

**Moment**
- `id`, `family_id`, `title`, `summary`, `language`, `tags_json`,
  `time_hint_json`, `place_hint`, `source` (`older_session|family_upload|mixed`),
  `trailer_config_json`, `created_at`, `updated_at`

**MomentAsset** (join)
- `moment_id`, `asset_id`, `role` (`hero|support|voice_note|session_audio`)

**MomentPerson** (join)
- `moment_id`, `person_id`

**Transcript**
- `id`, `moment_id`, `asset_id` (audio), `language`, `text`,
  `text_en`, `timestamps_json` (optional), `created_at`

---

## 8) AI Capabilities (V1)

### A) Voice Companion (OpenAI Realtime)
- Client streams mic audio
- Receives assistant audio (play immediately)
- Session end: store user audio + transcript, then post-process

**Conversation constraints**
- Warm, validating tone
- One question at a time
- Avoid “testing memory”
- Offer “switch to music” if user is tired

### B) Post-session processing (FastAPI background task in V1)
After audio saved:
1. Transcribe
2. Language detect
3. Translate to English (for indexing)
4. Summarize:
   - 1–2 sentence summary
   - Short caption (<= 12 words)
5. Extract tags/entities:
   - names mentioned, places, time hints, themes
6. Create/update `Moment` and link `Assets` + `Transcript`
7. Update trailer_config (optional refresh)

### C) Family upload processing
- Photo: generate tag suggestions (basic)
- Voice note: transcribe + translate + create a “prompt suggestion” for the older adult
- Attach to an existing Moment or create a new Moment

---

## 9) Backend API (FastAPI) — V1 Endpoints

### Auth & Family
- `POST /auth/start` (email)
- `POST /auth/verify` (otp)
- `POST /family/create`
- `POST /family/join` (invite token)

### Media (Azure Blob SAS flow)
- `POST /media/sas`
  - input: `{ type: "photo"|"audio", contentType, fileName }`
  - output: `{ uploadUrl, blobUrl, expiresAt }`
- `POST /media/complete`
  - input: `{ blobUrl, type, metadata }`
  - output: `{ assetId }`

### Moments
- `POST /moments`
- `GET /moments?personId=&q=&from=&to=`
- `GET /moments/{id}`
- `PATCH /moments/{id}` (title/summary/tags; curator)

### People
- `POST /people`
- `GET /people`

### Realtime
- `POST /realtime/token`
  - output: ephemeral token/config for browser Realtime session
- `POST /sessions/complete`
  - input: `{ audioAssetId, sessionMeta }`
  - triggers post-processing

---

## 10) Security / Privacy (V1)

- Family content is private by default.
- Assets stored in private blob containers.
- Access via:
  - short-lived signed URLs (generated by backend), or
  - proxy endpoint (later), or
  - private + authenticated streaming (V1 can use signed URLs)

- Consent reminder at onboarding:
  - “Please upload only media you have permission to share.”

- Deletion:
  - V1: soft delete records + scheduled hard delete later

---

## 11) Azure Option B Deployment Targets (High-Level)

- **Next.js SSR**: Azure App Service (Linux, Node)
- **FastAPI**: Azure Container Apps (containerized)
- **Postgres**: Azure Database for PostgreSQL Flexible Server
- **Blob**: Azure Blob Storage (private containers)
- **Secrets**: Azure Key Vault

---

## 12) Performance & Device Compatibility (V1)

### Mobile/tablet/desktop responsiveness
- Touch targets >= 44px
- Captions default ON
- Avoid hover-only UI
- Use `clamp()` typography
- One-column mobile layout; 2–3 columns on tablet/desktop

### Media
- Always store thumbnails for photos
- Avoid server-side image resizing in V1 (keep simple)
- Use lazy loading for bank feed

---

## 13) Observability & Metrics (V1)

Track:
- Older sessions per week
- Family uploads per week
- Trailer play count + replay rate
- 7-day return rate per family group
- Average session length
- Language distribution
- Drop-off points by route

---

## 14) V1 Milestones (Practical)

M1: Local demo
- Realtime talk works
- Save audio + transcript + summary

M2: Memory bank CRUD
- timeline feed + moment detail

M3: Trailer + prompt
- client-side montage config
- save moment from older session

M4: Family upload
- photo upload + optional voice note

M5: Auto-language + lock
- confirm prompt if uncertain
- switch language button

---

## 15) Post-V1 Roadmap Hooks

- Add Gemini later for long-video parsing + diarization + batch processing
- Smart clipping for videos into snippets
- Monthly “Family Episode” generator (2–4 min)
- Export “LifeBook PDF” + memorial reel
- Fine-grained permissions per asset/moment
