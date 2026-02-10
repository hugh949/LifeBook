# Testing Voice ID and Updated Features

Checklist for manually testing Voice ID (identify + enroll) and the updated copy and realtime behaviour.

**Setup:** Run migrations (including 010 for Eagle). Voice ID uses **Picovoice Eagle** by default: set `PICOVOICE_ACCESS_KEY` in root `.env` (get key from [Picovoice Console](https://console.picovoice.ai)). Optional: `VOICE_ID_BACKEND=azure` and Azure Speech keys if using Azure. See `.env.example` and README.

## Voice ID

1. Open **http://localhost:3000** → **Older** → **Talk** (no moment or story selected).
2. Click **Start talking.**
3. **If at least one participant has a voice profile:** You should see **"Just a moment…"** while the app records ~6 seconds and calls `POST /voice/identify`. If recognized, the session connects with that participant (agent can greet by name).
4. **If not recognized (or no one enrolled yet):** Session connects without a participant. The agent does "getting to know you," asks for a name, then calls `create_participant`. After creation, the app uploads the rolling buffer to `POST /voice/participants/{id}/enroll`. Once enrollment succeeds, that participant has a voice profile for the next session.
5. **First-time test:** Start a session → say your name when the agent asks → let enrollment run. Start a new session; you should see "Just a moment…" and then be recognized.

## Updated copy and behaviour

- **Session live message:** After connecting, the in-session message should be user-facing (e.g. "You're live. Speak naturally — one question at a time.") with no internal jargon.
- **Home / bank / older pages:** Messaging should reflect family and "future generations" (e.g. bank: "A place for your whole family to revisit stories together — today and for future generations.").
- **Realtime:** The agent should describe the family memory bank and offer to share the story with the family when ready.

See also **Validation_and_Rollback.md** for production smoke test.
