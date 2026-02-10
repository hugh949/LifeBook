# Voice Agent as Family Story Custodian — Design

The voice agent is the **custodian and story keeper** for the family: it knows who is speaking, keeps every conversation in context, and guides the **story-making** process from discussion to a finalized, shareable story. This doc captures the product vision and design so we can implement it in clear, buildable steps.

**Core idea:** A **conversation** is a **discussion** between the participant and the voice agent — and that discussion is the **process of story making**. The agent helps turn the discussion into a complete story, then the participant can refine it, choose how it’s recorded (in their own voice or the agent’s), and when ready share it with the family.

---

## 1. Identity: recognize or ask name

- **If the voice is recognized** (from previous sessions): greet the person **by name** (e.g. “Hi Sarah, good to hear you again”).
- **If the voice is not recognized**: ask for their name (e.g. “I don’t think we’ve met yet — what should I call you?”). From there we treat them as a new participant and store their name for future recognition.

So identity is **voice-first**: we aim to recognize returning family by voice; “what’s your name?” is the fallback for new or unrecognized speakers. Implementation can start with “ask name” and add voice fingerprinting/enrollment later.

---

## 2. Conversation continuity and recall

- **Default:** Conversations **continue from where they left off** for that person. When they start a new session, the agent has context from their previous sessions (no mixing with other family members).
- **Recall a past topic:** If the person says they want to **recall and discuss something they talked about before** (e.g. “Can we go back to what we said about the wedding?”), the agent should **bring that earlier conversation into context** and then continue the conversation from there.
- So we need:
  - Per-person conversation history (sessions + turns).
  - On session start: load recent context so we “continue from where we left off.”
  - On demand: when the user asks to “recall” or “go back to” a topic, retrieve that past conversation (or session) and inject it into context so the agent can reference it and continue.

---

## 3. Saving and deleting

- **All conversations are automatically saved** — the user does **not** have to say “save this.” Every session is stored for that person’s history.
- **Exceptions (user in control):**
  - If the person says to **delete the current conversation**, we do not keep it (or mark it as deleted / do not persist).
  - If they **recall a previous conversation and then ask for it to be deleted**, we remove or hide that one.
- So: **default = save**; **explicit “delete” = don’t save or remove**. The agent should understand phrases like “forget this conversation” or “delete what we just talked about” and act accordingly.

---

## 4. Story making: from discussion to final story

A **conversation** is a **discussion** between the participant and the voice agent — the **process of story making**. The flow is:

1. **Discussion** — Participant and agent talk; the conversation is auto-saved and continues from where they left off (per-person context).
2. **Agent offers to turn discussion into a story** — At some point the agent can offer: *“Would you like me to turn our discussion into a complete story and play it back for you?”*
3. **Playback and feedback** — The agent generates a draft story and **plays it back**. The participant can give **comments** to make changes. The agent revises; they can repeat playback and feedback until the story feels right.
4. **Story is final** — When the participant is satisfied, the agent asks: *“Would you like to **tell the story in your own words** (you record), or would you prefer **I record the story** in my voice?”* Either way, the final story is recorded.
5. **Share with family** — When the story is final and ready, the agent asks: *“Would you like to share this story with the family?”* If yes, it becomes **available in the memory bank** for anyone in the family to hear.

So: **conversation = discussion = story-making process**. The **story** is the **finalized, recorded** result (in the participant’s voice or the agent’s) that can then be **shared**. Until the participant agrees to share, everything stays **private** to that person.

---

## 5. Conversation starter: snapshot of new family stories

**Whenever a participant connects** with the voice agent, as a **conversation starter** the agent can offer: *“Would you like a snapshot of **new family stories** you may not have listened to yet?”* (if any are available). This gives returning family a natural way to catch up on what others have shared before diving into their own discussion or story making.

---

## 6. Discovering and playing shared stories via voice

- Family members can **ask the voice agent** for a **snapshot of new stories shared by the family** (e.g. “What new stories has the family shared?” or “Any new stories from Mom?”).
- They can then **ask to play a specific one** (e.g. “Play Sarah’s story from last week” or “Play the one about the wedding”).
- So the voice agent is the **interface to the memory bank** for shared stories: list new shared stories, then play on request. This keeps the experience voice-first and makes the agent the single “custodian” for both talking and listening to family stories.

---

## 7. Summary: voice agent as custodian

| Area | Behavior |
|------|----------|
| **Identity** | Recognize returning voice → greet by name. Unrecognized → ask name, then treat as new participant. |
| **Conversation** | Discussion between participant and agent = **story-making process**; auto-saved, continues from where they left off. |
| **Recall** | User can ask to “recall” or “go back to” a past topic; agent brings that conversation into context and continues. |
| **Saving** | Auto-save all conversations. User can say “delete this conversation” or “delete that one we recalled” to remove. |
| **Story making** | Agent can offer to convert discussion → complete story → play back → participant comments/edits → repeat until final → choose: tell in own words (participant records) or agent records → then offer to share with family. |
| **Sharing** | Only when the participant agrees to share does the final story become available in the memory bank for the family to hear. |
| **Conversation starter** | On connect, agent can offer a snapshot of **new family stories** the participant may not have listened to yet (if any). |
| **Stories in the bank** | Family can ask “What new stories have been shared?” and “Play [that story]” — agent lists and plays shared stories. |

---

## 8. Mapping to implementation (phased)

We can build toward this in stages so each step is testable and shippable.

| Phase | Focus | Delivers |
|-------|--------|----------|
| **A. Identity (name first)** | “Who is speaking?” — ask name if not known; store name; greet by name on return. Optional: simple manual list (Older adult, Sarah, …) before we have voice ID. | Per-person identity; no mixing of histories. |
| **B. Auto-save + continuity** | Automatically save every session (with turns) for that person. On session start, load recent context and inject into agent instructions so conversation “continues from where they left off.” | Full per-person history; agent has prior context. |
| **C. Recall on demand** | User can say “recall what we said about X” or “go back to last week’s conversation.” Backend: retrieve past sessions/topics for that person; agent injects that conversation into context and continues. | Topic-level recall; conversation continues from that point. |
| **D. Delete on request** | Agent understands “delete this conversation” / “forget what we just said” and “delete that story we recalled.” Backend: mark session as deleted or do not persist. | User control over what’s kept. |
| **E. Story-making flow** | Agent offers to convert discussion → story; play back; participant comments/edits until final; then choose: tell in own words (participant records) or agent records. When final, offer to share. | Full story-making loop: draft → feedback → final → record → share. |
| **F. Share story → memory bank** | When participant agrees to share, create a **shared** story in the memory bank. Only then is it available for the family to hear. | Clear boundary: private until shared. |
| **G. List and play shared stories via voice** | Agent can answer “What new stories have been shared?” (list) and “Play [that story]” (play). On **session start**, agent can offer a snapshot of new family stories the participant may not have heard yet. | Voice-first discovery, playback, and conversation starter. |
| **H. Voice ID (optional later)** | Use voice to recognize returning family so we don’t have to ask name every time; still ask name when unrecognized. | Smoother “greet by name” experience. |

Phases A and B align with the existing **Voice_Conversation_History_Plan.md** (participant identity, save session + turns, recall context). This document adds the **product behavior** (conversation = story-making, draft → playback → feedback → final → record → share, conversation starter with new stories) so that the technical steps stay aligned with the story-custodian vision.

---

## 9. Design decisions to lock in

- **Conversation vs story:** A **conversation** is the **discussion** between participant and agent — the **process of story making** (private, auto-saved, per person). A **story** is the **finalized, recorded** result (in the participant’s voice or the agent’s) that can then be **shared** with the family. So: conversation = discussion = story-making; story = final recorded artifact that becomes shareable.
- **Story-making loop:** Discussion → agent offers to convert to story → play back → participant comments → revise → repeat until final → choose recording mode (own voice vs agent) → record → offer to share → if yes, available in memory bank.
- **Conversation starter:** When a participant connects, the agent can offer a snapshot of **new family stories** they may not have listened to yet (if any). This is part of the “list and play shared stories” capability, triggered at session start.
- **Granularity of recall:** Recall can be “last session,” “session about X,” or “topic X” (might span sessions). We can start with “last N sessions” and “session by topic/summary” and refine.
- **Granularity of delete:** “Delete this conversation” = current session. “Delete that one we recalled” = the recalled session (or topic). We can start with session-level delete.
- **Playback of shared stories:** Shared stories can be played back as audio (participant’s recording or agent’s recording). “Play Sarah’s story” (format, length, summary vs full) can be refined when implementing list/play.

This design doc should stay the single source of truth for **what** the voice agent does as story custodian. **Incremental_Build_Plan_Story_Making.md** organizes the work into local-only increments (Build 1–8); **Voice_Conversation_History_Plan.md** and implementation can reference both for **how** to build each phase.
