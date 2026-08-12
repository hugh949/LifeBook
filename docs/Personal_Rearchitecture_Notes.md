# Personal re-architecture notes

This doc is a short map of the LifeBook app after the personal-private
re-architecture. It's aimed at future maintainers who need to orient
themselves quickly.

## One-line summary

> Private memory keeper. Private by default. Share specific items via
> per-link tokens, narrated in the owner's cloned voice by a pencil-sketch
> portrait of the owner. Recipients need no account.

## Identity model

- **User** (`users` table) &mdash; email + bcrypt password hash + display
  name. Session is an HS256 JWT in the HttpOnly cookie
  `SESSION_COOKIE_NAME` (default `lb_session`), signed with
  `SESSION_SECRET`, lasting `SESSION_TTL_DAYS` days.
- **No family / participant concept.** Every user only ever sees their own
  rows. We key every owned resource on `owner_user_id`.
- Voice cloning and avatar are per-user personalization; they only affect
  *how* the owner's shared narrations sound and look, not who can read
  anything.

## Core tables (migration `017_personal_rearchitecture.py`)

| Table | Owner | Notes |
|-------|-------|-------|
| `users` | &mdash; | id, email (unique), password_hash, display_name, created_at |
| `user_voice` | 1:1 user | status (`none|recording|processing|ready|failed`), elevenlabs_voice_id, consent_at, error |
| `user_avatar` | 1:1 user | status (`none|pencilizing|ready|failed`), original_blob_url, pencil_blob_url |
| `assets` | user | blob_url, type (`audio`/`image`), metadata_json |
| `conversations` | user | session_turns_json, summary, tags_json, audio_asset_id, deleted_at |
| `transcripts` | via conversation | raw/EN text, language |
| `stories` | user | title, story_text, summary, source_conversation_id, deleted_at |
| `story_bgm_cache` | via story | optional ElevenLabs music cache |
| `shares` | user | id = token (opaque URL-safe), code_hash (optional SHA-256 of token+4-digit code), revoked_at |
| `share_comments` | via share | recipient_name + text (anonymous recipients) |

All content tables use soft-delete (`deleted_at`). Shares are revoked by
setting `revoked_at`.

## Backend endpoint map

| Prefix | Router | Auth |
|--------|--------|------|
| `/health` | `health.py` | public |
| `/auth/{signup,signin,signout}` `/auth/me` | `auth.py` | public; `/me` cookie |
| `/me/voice*` | `me_voice.py` | cookie |
| `/me/avatar*` | `me_avatar.py` | cookie |
| `/media/*` | `media.py` | cookie |
| `/realtime/token` & SDP proxy | `realtime.py` | cookie |
| `/sessions/complete` | `sessions.py` | cookie |
| `/stories/confirm` | `library.py` | cookie (called from realtime tool) |
| `/library*` | `library.py` | cookie |
| `/shares` (owner list/create/revoke) | `shares.py` | cookie |
| `/shares/{token}` (meta/unlock/playback/narration/comments) | `shares.py` | public |

`get_current_user` in `app.core.security` is the single gate; it reads the
session cookie, verifies the JWT, and loads the user.

## Frontend routes

| Route | Public? | Notes |
|-------|---------|-------|
| `/signin`, `/signup`, `/forgot-password`, `/reset-password` | yes | Email + password; forgot/reset |
| `/` | &mdash; | Redirects to `/talk` |
| `/talk` | no | Single-screen voice session; agent calls `confirm_story` |
| `/library` | no | Lists conversations + stories |
| `/library/conversations/[id]` | no | Detail, Share, Continue, Delete, comments feed |
| `/library/stories/[id]` | no | Detail, Share, Refine, Delete, comments feed |
| `/me` | no | Account, voice status, avatar status, sign out |
| `/me/voice` | no | Five-state wizard |
| `/me/avatar` | no | Selfie upload + pencil-sketch preview |
| `/s/[token]` | yes | Recipient view: password unlock, narration + BGM, comments after unlock |

`apps/web/src/middleware.ts` enforces auth for any non-public path. Public
paths: `/signin`, `/signup`, `/s/*`, `/bgm/*`, `/api/*`, `_next/*`, favicon.

## Sharing flow

1. Owner opens **Share when ready** on a detail page. `ShareSheet` POSTs to
   `/shares` with `target_type`, `target_id`, and a **required** `password`.
   Server stores a URL-safe token and `sha256("{token}:{password}")` in `code_hash`.
2. Copyable URL is `${window.origin}/s/${token}`. Owner can **change password**
   (`PATCH /shares/{token}`) or **remove access** (`DELETE`) without recreating the story.
3. Recipient opens `/s/[token]`:
   - `GET /shares/{token}` &rarr; minimal meta (owner name only; no teaser).
   - Recipient enters password &rarr; `POST /shares/{token}/unlock` returns `PlaybackOut`.
4. The `<audio>` element streams `/shares/{token}/narration?password=…`.
5. Comments require the same password. Owner sees them on the detail page.

See also [Five_Agent_Architecture.md](Five_Agent_Architecture.md).

## Avatar animation

Intentional first cut: static pencil-sketch PNG (produced by
`gpt-image-1` on selfie upload) plus an overlayed two-shape mouth driven by
an `AnalyserNode` on the narration `<audio>` element. Implemented in
`apps/web/src/app/components/Avatar.tsx` with
`apps/web/src/lib/avatarProvider.ts`. The provider interface makes it
trivial to swap in a pre-rendered lip-sync video later (kind `"video"`).

## What was removed

- All family / participant / voice-ID identification (Picovoice Eagle, Azure
  Speech), because identity is now email + password.
- Old routes: `/family`, `/older`, `/p`, `/invite`, `/bank`, `/my`,
  `/create`, `/m`, `/talk/memories`.
- Old APIs: `routers/moments.py`, `routers/voice.py`, `routers/people.py`
  and their schemas/services.
- `lib/i18n.ts` (pilot ships English-only).

## Required env vars

See `.env.example`. The ones specific to this re-architecture:

- `SESSION_SECRET` &mdash; HS256 signing key. Required in production;
  defaulted for local dev.
- `SESSION_COOKIE_NAME` (default `lb_session`)
- `SESSION_TTL_DAYS` (default `30`)

Voice cloning and narration need `ELEVENLABS_API_KEY`; pencil-sketch
avatars and realtime both need `OPENAI_API_KEY`; photo/audio storage
needs `AZURE_STORAGE_*`.

## Pilot-phase constraints

Deliberately simple:

- Share links always require a user-chosen password (not optional). Rate-limited
  to 5 failed attempts / 30s per token.
- Soft-delete keeps data around; there is no user-facing data export or
  "delete my account" flow yet.
- Lip-sync is amplitude-based, not phoneme-accurate. Good enough for a
  personal keepsake; swap in true lip-sync later via `AvatarProvider`.
- We intentionally dropped speaker recognition for the pilot to simplify
  onboarding; personal voice clone is still fully supported.
