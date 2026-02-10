# Incremental Build Plan: Story Making and Story Sharing (Local)

**Principle:** Build and refine this feature **entirely in the local environment**. Use many iterations to fix subtle UX issues. **Release to production only when the whole user experience is working well.**

**References:** Product behavior is defined in **Voice_Agent_Story_Custodian_Design.md**. Technical details for identity, save, and recall are in **Voice_Conversation_History_Plan.md**.

---

## Build order (logical and technical)

Each build is a **increment**: implement → run locally → test and refine UX → repeat until solid → then move to the next. No production deploy until the full flow (at least through Build 6 or 7) is in good shape.

| # | Build | Goal | Depends on |
|---|--------|------|------------|
| 1 | **Participant identity** | Know who is speaking; greet by name on return; ask name if new. | — |
| 2 | **Auto-save + continuity** | Save every session (with turns) per participant; on session start, load recent context so conversation continues from where they left off. | 1 |
| 3 | **Recall on demand** | User can ask to “recall what we said about X”; agent brings that conversation into context and continues. | 2 |
| 4 | **Delete on request** | User can say “delete this conversation” or “delete that one we recalled”; backend removes or marks as deleted. | 2 |
| 5 | **Story-making flow** | Agent offers to convert discussion → story → play back → participant comments/edits → repeat until final → choose: tell in own words (participant records) or agent records → when final, offer to share. (Story still private.) | 2 |
| 6 | **Share story → memory bank** | When participant agrees to share, story becomes a shared asset in the memory bank; only then can family hear it. | 5 |
| 7 | **List and play shared stories + conversation starter** | Agent can list “new family stories” and play a specific one on request; on session start, offer snapshot of new stories the participant may not have heard. | 6 |
| 8 | **Voice ID (later)** | Recognize returning speaker by voice; greet by name without asking; ask name only when unrecognized. | 1, 2 |

---

## Build 1 — Participant identity

**Goal:** Establish who is speaking. Ask for name if we don’t know them; greet by name when we do.

**Scope**

- **Backend:** `voice_participants` table (`id`, `family_id`, `label`, `created_at`). Seed default family with “Older adult”. **GET /voice/participants** (list). **POST /voice/participants** (add by name when agent “asks” — can be driven by client or a simple “add participant by name” API used when user says their name).
- **Frontend:** Before or at session start, resolve participant: if returning (we have a list and can pick or we’ll use “ask name” flow), show or speak; if new, agent asks name and we create/add participant. For local iteration, a simple **“Who is speaking?”** dropdown (list from GET) is enough; we can replace with “agent asks name” and create-on-the-fly in a UX pass.
- **Token:** **POST /realtime/token** accepts `participant_id` (and optionally `participant_name` for first-time); backend stores or resolves participant and can inject “Greet by name: Sarah” (or “Ask for their name”) into instructions so the agent behaves correctly.

**Deliverable:** Every session is tied to a participant; agent can greet by name or ask name. Test locally with 2–3 participants.

**Exit criteria:** Two different “participants” can have separate identity; agent says the right thing on start.

---

## Build 2 — Auto-save + continuity

**Goal:** Every conversation is saved automatically; next time that person talks, the agent has context and “continues from where they left off.”

**Scope**

- **Backend:** Add `participant_id` (FK to `voice_participants`) to `moments`; add `session_turns_json` (or `voice_turns` table) to store turns. **POST /sessions/complete** accepts `participantId`, `turns[]`; creates Moment with `participant_id` and stores turns. **GET /voice/context?participant_id=** returns last N turns for that participant.
- **Realtime token:** When minting token, if `participant_id` is sent, backend calls GET context and appends “Previous context for this person: …” to the agent instructions.
- **Frontend:** On “End session”, call **POST /sessions/complete** with `participantId` and `turns`. Capture turns from Realtime data channel (`oai-events`) during the session so we can send them on end. If turn capture is complex, send at least `participantId` and a single transcript/summary first, then add full turns in a follow-up.

**Deliverable:** Sessions are saved per participant; starting a new session for the same participant loads recent context and the agent continues naturally.

**Exit criteria:** Have a short conversation, end session, start again as same participant — agent references or continues from before.

---

## Build 3 — Recall on demand

**Goal:** User can say “recall what we said about the wedding” (or similar); agent brings that past conversation into context and continues from there.

**Scope**

- **Backend:** **GET /voice/context?participant_id=&topic=** or **&session_id=** (or search by summary) returns turns for that topic/session. Agent instructions: when user asks to “recall” or “go back to,” backend can be called mid-session (or we inject a larger context at start). Simpler approach: at session start, include short summaries of past sessions so the agent can say “we talked about X, Y, Z”; when user says “let’s go back to X,” we could either (a) inject that session’s turns in a follow-up token/instruction update, or (b) rely on the agent having had summaries and the user re-describing. For V1, **retrieve past session(s) by participant + optional topic/summary** and return as context; agent gets “Recalled conversation: …” in instructions.
- **Frontend:** May need a way to trigger “load context for topic X” (e.g. user says “recall the wedding” and we call an API to get that context and pass to the agent). If Realtime API doesn’t support mid-session context injection, we can start with “last N sessions” in the initial context and let the agent refer to them; then add explicit “recall topic” API when we have a way to push context (or start a new session with “recall” pre-loaded).

**Deliverable:** User can ask to go back to a past topic; agent has that conversation in context and continues from there.

**Exit criteria:** Past conversation about a topic can be recalled and discussed again in a natural way.

---

## Build 4 — Delete on request

**Goal:** User can say “delete this conversation” or “delete that one we recalled”; we don’t keep it or we mark it deleted so it’s not used for context or story-making.

**Scope**

- **Backend:** **DELETE /voice/sessions/:id** or **POST /voice/sessions/:id/delete** (soft delete). When loading context (Build 2, 3), exclude deleted sessions. Optionally: “delete current conversation” = don’t persist when they end session (flag or skip calling sessions/complete).
- **Agent instructions:** Agent understands “forget this conversation,” “delete what we just talked about,” “delete that story we recalled.” Agent can confirm and then client or backend marks session as deleted or skips save.

**Deliverable:** User can delete the current or a recalled conversation; it no longer appears in history or context.

**Exit criteria:** After deleting a conversation, it’s not used in context and (where applicable) not shown in history.

---

## Build 5 — Story-making flow

**Goal:** Discussion can be turned into a “story”: agent offers to convert to a complete story, plays it back, participant gives feedback, we iterate until final, then user chooses to tell it in their own words (record) or have the agent record it. When final, agent offers to share (actual sharing is Build 6).

**Scope**

- **Conversation = story-making:** Agent instructions include: at appropriate times, offer to “turn our discussion into a complete story and play it back.” Agent can generate a draft story (text) and “play” it (TTS via Realtime). Participant can give comments; agent revises and replays. When participant is satisfied, agent asks: “Would you like to tell the story in your own words, or have me record it?” 
- **Recording:** (1) **Participant records:** User records themselves (we already have voice); we save that as the “final story” audio. (2) **Agent records:** Agent speaks the final story (TTS); we capture and save that audio. Backend needs a place to store “story” (draft text, final audio, participant_id, not-yet-shared). New model or fields: e.g. `stories` table (participant_id, moment_id or session_id, draft_text, final_audio_asset_id, status: draft | final | shared).
- **No sharing yet:** “Share with family” is offered by the agent but actual sharing (visibility in memory bank) is Build 6. Build 5 only gets the story to “final and recorded.”

**Deliverable:** Full loop: discussion → offer to make story → play back → feedback → revise → final → choose record mode → record. Story is stored but still private.

**Exit criteria:** User can complete a story and have it recorded (own voice or agent); story is not yet visible to family.

---

## Build 6 — Share story → memory bank

**Goal:** When the participant agrees to share, the story becomes a shared asset in the memory bank so anyone in the family can hear it.

**Scope**

- **Backend:** Stories that are “final” can be marked **shared**. Shared story creates (or links to) a **moment** or story asset in the memory bank with a “shared” or “visible to family” flag. GET endpoints for “family stories” return only shared ones.
- **Agent:** When story is final and recorded, agent asks “Would you like to share this story with the family?” If yes, client or agent triggers share API; backend marks story as shared and makes it available to the family.

**Deliverable:** Finalized stories can be shared; once shared, they appear in the memory bank for the family.

**Exit criteria:** Share a story; it shows up in the memory bank (or family story list); unshared stories do not.

---

## Build 7 — List and play shared stories + conversation starter

**Goal:** Family can ask the agent “What new stories have been shared?” and “Play [Sarah’s story / the one about the wedding].” When a participant connects, the agent offers a snapshot of new family stories they may not have heard yet.

**Scope**

- **Backend:** **GET /voice/stories/shared** (or /family/stories) — list shared stories (with title, participant, summary, date). **GET /voice/stories/:id/play** or asset URL for playback. Track “listened” per participant so we can say “new stories you may not have heard” (optional).
- **Agent instructions:** Agent can describe how to answer “what new stories?” and “play story X.” If we pass “new shared stories” (or summaries) in the initial context when a participant connects, the agent can offer: “Would you like a snapshot of new family stories you may not have listened to yet?”
- **Frontend:** Playback of shared story (audio) when user asks to play one — either in-session (agent triggers playback) or via a simple play control. Conversation starter is mostly agent instructions + context (list of new stories when session starts).

**Deliverable:** Agent can list new shared stories and play a specific one; on session start, agent offers snapshot of new stories.

**Exit criteria:** User can ask for new stories, hear the list, and ask to play one; on starting a session, agent offers the snapshot when there are new stories.

---

## Build 8 — Voice ID (later)

**Goal:** Recognize returning speaker by voice; greet by name without asking; ask name only when unrecognized.

**Scope:** Voice fingerprinting or enrollment; match on connect; pass recognized participant_id to token. Out of scope until Builds 1–7 are stable and UX is refined locally.

---

## Local-only development

- **Run stack:** Use `./scripts/run-local.sh` (or your usual local setup). All builds are tested at http://localhost:3000 and with the local API/DB.
- **No production deploy** for this feature until you’re satisfied with the end-to-end experience (at least through Build 6 or 7). Keep story-making/sharing on a **feature branch** or behind a flag if you need to deploy other work.
- **Iterate:** After each build, use the app locally, note UX issues, refine, and repeat. Then move to the next build.

---

## Summary

| Build | Focus | Key deliverable |
|-------|--------|-----------------|
| 1 | Participant identity | Who is speaking; greet by name or ask name. |
| 2 | Auto-save + continuity | Sessions saved; conversation continues from where they left off. |
| 3 | Recall on demand | Bring a past topic into context and continue. |
| 4 | Delete on request | User can delete current or recalled conversation. |
| 5 | Story-making flow | Discussion → story → play back → feedback → final → record (own or agent); still private. |
| 6 | Share story → memory bank | Final story can be shared; then visible to family. |
| 7 | List/play + conversation starter | “What new stories?” / “Play that one”; offer snapshot on connect. |
| 8 | Voice ID (later) | Recognize by voice; greet by name without asking. |

This order is logical (identity and history first, then story-making, then sharing and discovery) and technical (each build adds one layer without blocking the next). Develop and refine each increment locally; release to production only when the whole story-making and story-sharing experience works well.

---

## Tech stack adequacy (Builds 1–8)

**Current stack:** Next.js (web), FastAPI (API), PostgreSQL + SQLAlchemy + Alembic, OpenAI Realtime API (WebRTC + ephemeral token), Azure Blob Storage (optional; local stub for dev), existing Asset/Moment/Transcript models and media upload (SAS + complete).

| Build | Needs | Covered by current stack? | Notes |
|-------|--------|----------------------------|--------|
| **1. Participant identity** | DB table, REST endpoints, token accepts body, dynamic instructions | Yes | Postgres + FastAPI; token mint already builds `session.instructions`; add `participant_id` (and optional name), load participant, append “Greet by name: X” or “Ask for their name.” |
| **2. Auto-save + continuity** | Store turns per session, GET context, inject into token; client sends turns on end | Yes | New columns or table (e.g. `session_turns_json`); existing `sessions/complete`; token can accept `participant_id` and inject “Previous context: …”. **Turns:** Realtime sends `conversation.item.added` / `conversation.item.done` and transcription events on the `oai-events` data channel — parse in the client, accumulate, send to `/sessions/complete`. No new tech. |
| **3. Recall on demand** | Retrieve past session(s) by participant + topic/summary; give to agent | Yes | GET endpoint returning turns for a session or matching a topic (e.g. by summary text or last N sessions). **Mid-session context:** Realtime API supports **session.update** over the data channel; client can send updated instructions (e.g. “Recalled conversation: …”) so we don’t need to restart the session. Use existing WebRTC + oai-events. |
| **4. Delete on request** | Soft-delete or skip persist; exclude from context | Yes | Flag on session/moment or a small “deleted” table; filter in GET context and story APIs. |
| **5. Story-making flow** | Draft story (text), TTS play back, record (user or agent), store draft + final | Yes | **Draft:** Agent generates text in conversation; we can store it (e.g. in a `stories` table or JSON on moment). **Play back:** Realtime already does TTS (agent speaks). **Record user:** Mic is already available; use MediaRecorder (or similar) in the client, then upload via existing media SAS + complete to create an Asset. **Record agent:** Capture the remote audio track from WebRTC (or the same audio element output via Web Audio API / MediaRecorder) and upload as Asset. All doable in the browser and existing upload pipeline. |
| **6. Share → memory bank** | Mark story as shared; family-visible list | Yes | Existing Moment/Asset and family_id; add a “shared” or “visibility” flag (or a dedicated shared-stories view). No new infra. |
| **7. List/play + conversation starter** | List shared stories, play audio, “new stories you haven’t heard” | Yes | GET shared stories (with optional “listened by participant” tracking); playback via existing blob URLs or SAS for audio assets. Conversation starter = include “new shared stories” (or summaries) in initial context when minting token so the agent can offer the snapshot. |
| **8. Voice ID** | Recognize speaker by voice; greet by name without asking | **Likely new tool** | Current stack has no speaker recognition. Options: (1) **Azure Speaker Recognition** (or similar) — enroll voice per participant, identify on connect; (2) **OpenAI** — if/when they offer speaker or voice ID; (3) another third-party API. Build 8 is “later”; you can ship Builds 1–7 with “ask name” and add voice ID when you’re ready. |

**Summary:** Builds 1–7 are achievable with the **current stack** (Next.js, FastAPI, Postgres, OpenAI Realtime, existing storage and media). The only build that likely needs a **new technology or service** is **Build 8 (Voice ID)** — speaker recognition — which you can adopt later (e.g. Azure Speaker Recognition or an OpenAI offering) without blocking the rest.
