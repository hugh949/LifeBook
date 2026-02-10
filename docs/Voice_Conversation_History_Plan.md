# Voice conversation history (per-participant)

**Goal:** Keep voice conversation history **separate per participant** (older adult vs different family members) so follow-up sessions can use the right context for each person.

**Product vision:** See **Voice_Agent_Story_Custodian_Design.md** for the full design: recognize-or-ask-name, auto-save, recall topic on demand, delete on request, share story → memory bank, list/play shared stories via voice.

**Approach:** Implement in small steps: participant identity → save session with participant + turns → recall context for follow-up → (later) optional voice ID.

---

## Current state

- **Voice session:** `/older/session` → get Realtime token → WebRTC to OpenAI. Conversation stays in the browser/OpenAI; no participant concept.
- **Backend:** `POST /sessions/complete` exists (creates Moment + Transcript) but is **not called** by the session page. No participant or turn-level storage.
- **DB:** Moment has `family_id`, `source` (e.g. `older_session`). No `participant_id`; no structured conversation turns.

---

## Step 1 – Participant identity (“Who is speaking?”)

**What:** User picks who is talking before starting a voice session. History will be stored and recalled per participant.

**Backend**

- New table `voice_participants`: `id`, `family_id`, `label` (e.g. "Older adult", "Sarah"), `created_at`. Use same `ID_TYPE` as other tables.
- Seed default family with one row: "Older adult".
- **GET /voice/participants** (or `/sessions/participants`) – list participants for the default family. Returns `[{ id, label }]`.
- Optional: **POST** to add a participant (e.g. "Sarah", "James") for the family.

**Frontend**

- On `/older/session`, before “Start talking”: dropdown or list **“Who is speaking?”** with options from GET participants. Store `participantId` in state.
- Pass `participant_id` when getting the token (optional in Step 1; required once we save). So **POST /realtime/token** body: `{ participant_id?: string }`. Backend can ignore it in Step 1 or log it.

**Deliverable:** User can select a participant; that id is available for the next steps. No DB change to Moment yet.

---

## Step 2 – Save session with participant and turns

**What:** When the user ends the session, save the conversation to the backend keyed by participant, so we can recall it later.

**Backend**

- Add **nullable** `participant_id` (FK to `voice_participants`) to `moments` for `older_session` moments. New migration.
- **POST /sessions/complete** body: add `participantId?: string`, `turns?: Array<{ role: "user" | "assistant", content: string }>`. Store `participant_id` on the new Moment. Store turns: either a new table `voice_turns` (moment_id, role, content, sequence) or a JSON column on Moment, e.g. `session_turns_json`. JSON is simpler for V1.
- If `turns` is empty but we have `transcriptText`, keep current behavior (one transcript per session); we can still attach participant_id to the moment.

**Frontend**

- When user clicks “End session”, call **POST /sessions/complete** with `participantId` (from Step 1) and, if available, `turns`.
- **Capturing turns:** The Realtime WebRTC flow uses a data channel `oai-events`. We need to listen for transcript/conversation events from OpenAI on that channel and accumulate user/assistant messages. When the session ends, send the collected `turns` to `/sessions/complete`. If the client doesn’t yet capture turns, send at least `participantId` and existing `transcriptText`/`sessionMeta` so we persist participant from the start; add turn capture in a small follow-up.

**Deliverable:** Each ended session creates a Moment with `participant_id` and optional `session_turns_json` (or voice_turns rows). History is partitioned by participant.

---

## Step 3 – Recall context for follow-up

**What:** When starting a new session for a participant, load their past context and give it to the agent so follow-up stays coherent and separate from other participants.

**Backend**

- **GET /voice/context?participant_id=xxx** – returns last N turns (or last session’s turns) for that participant. Query moments with `source=older_session` and `participant_id=xxx`, ordered by `created_at` desc, take recent `session_turns_json` (or voice_turns) and return as `{ turns: [{ role, content }, ...] }` or a short summary.
- **POST /realtime/token** body: `{ participant_id?: string }`. When `participant_id` is present, call GET logic to load context, then append to the Realtime instructions, e.g. “Previous context for this person (use for continuity, do not mix with other family members): …” with the last N turns or a summary. Mint the token with this extended instruction so the agent has per-participant memory.

**Frontend**

- When starting a session, we already pass `participant_id` to the token endpoint (Step 1). No change needed except ensuring we send it. The backend will inject context into the instructions automatically.

**Deliverable:** New sessions for a participant get prior context in the system prompt; context is isolated per participant.

---

## Step 4 (later) – Optional voice ID

**What:** Use voice fingerprinting or enrollment to suggest or auto-select the participant (e.g. “Sounds like Sarah”) instead of always requiring a manual choice. Can be added after Steps 1–3 are stable.

---

## Implementation order

| Step | Focus | Backend | Frontend |
|------|--------|--------|----------|
| 1 | Participant identity | voice_participants table, GET participants, token accepts participant_id | “Who is speaking?” dropdown, pass participant_id to token |
| 2 | Save with participant + turns | participant_id on Moment, session_turns_json or voice_turns, sessions/complete accepts participantId + turns | Call sessions/complete on End session; capture turns from oai-events (or start with participantId only) |
| 3 | Recall context | GET /voice/context, inject into /realtime/token instructions | Already passing participant_id |
| 4 | Voice ID (later) | Optional: voice profile / match API | Optional: “Is this Sarah?” confirmation |

---

## Files to touch (reference)

- **Backend:** `services/api/app/db/models.py`, new migration, `services/api/app/routers/realtime.py`, `services/api/app/routers/sessions.py`, new router or routes for `GET /voice/participants` and `GET /voice/context`.
- **Frontend:** `apps/web/src/app/older/session/page.tsx`, `apps/web/src/lib/realtime.ts` (token call with participant_id; optionally capture data channel events for turns).

We can implement Step 1 first, then 2, then 3, with a quick local test and deploy after each step using your existing validation flow.
