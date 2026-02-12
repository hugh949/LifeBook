# Verifying Voice Clone Narration

This guide explains how to verify that the cloned voice is being used for story narration.

## Quick verification

1. **After narrating a story** on the Shared Memories page, look for:
   - **"Your voice"** (green) next to "Tap to play" → cloned voice was used
   - **"Default voice (clone not used)"** (muted) → ElevenLabs was not used (see troubleshooting below)

2. **Browser console** (F12 → Console): When you tap "Narrate Story", look for:
   ```
   [narrate] TTS fetch starting { participant_id: "abc-123-..." }
   [narrate] TTS fetch completed { status: 200, ok: true, "X-Narration-Voice": "cloned", participant_id: "abc-123-..." }
   ```

3. **API logs** (Docker: `docker compose logs -f api`): Look for:
   ```
   voice/narrate: participant_id=... elevenlabs_voice_id=... elevenlabs_configured=True
   voice/narrate: used ElevenLabs cloned voice participant_id=... voice_id=...
   ```
   If you see `used OpenAI default voice` instead, the clone was not used.

## Diagnostic endpoint

Check if a participant has a cloned voice stored:

```bash
curl "http://localhost:8000/api/voice/participants/YOUR_PARTICIPANT_ID/narration-voice-status"
```

Example response when clone exists:
```json
{
  "has_narration_voice": true,
  "voice_id": "abc123xyz",
  "consent_at": "2025-02-11T12:00:00Z"
}
```

When no clone: `has_narration_voice: false`, `voice_id: null`.

## Troubleshooting: clone not used

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `participant_id: null` in console | Story has no author (legacy) or story came from wrong source | Re-share the story from My Memories after ensuring you're logged in as that participant |
| `elevenlabs_voice_id: null` in logs | Participant has no cloned voice | Clone voice: check "Clone my voice" and talk for about a minute |
| `elevenlabs_configured=False` in logs | `ELEVENLABS_API_KEY` not set in `.env` | Add `ELEVENLABS_API_KEY=your_key` to root `.env` |
| `used OpenAI default voice` after ElevenLabs attempt | ElevenLabs TTS failed (rate limit, invalid voice, etc.) | Check API logs for `ElevenLabs TTS failed`; verify voice_id in ElevenLabs dashboard |

## End-to-end test

1. Create a participant, clone voice (about 1 minute of speech), verify with `/narration-voice-status`
2. Create and share a story as that participant
3. Go to Shared Memories, tap "Narrate Story" on that story
4. Check UI shows "Your voice" and console shows `X-Narration-Voice: cloned`
