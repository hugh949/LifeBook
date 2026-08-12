# Narration background music (Curate + Share)

Curate Listen and share playback use **dual client audio**: narration MP3 + a background bed.

## How it works (current)

1. **Auto-curate** – Entering Curate calls **POST /library/stories/{id}/curate/suggest**. The Curator model (or heuristics) picks `bgm_track` + `narration_tone`, persists them, and returns a short reason.
2. **Unique bed (preferred when configured)** – If `ELEVENLABS_API_KEY` and Azure Blob are set, suggest kicks off background generation via ElevenLabs Music API (`music_generation.py`, ~**15s** instrumental loop to limit Music credits). The Curator music prompt (`generate_narrate_music_prompt`) infers likely **place/region** and **era/decade** from title/body/summary so the bed feels of that time and place (period instruments/atmosphere, still soft under speech). Uploads to the audio container and caches in `story_bgm_cache` / `stories.bgm_asset_id`. Preview/share return `bgm_url` (signed). Client loops the bed under narration. Cached so Listen does not regenerate.
3. **Library fallback** – Static loops in `apps/web/public/bgm/{neutral,warm,reflective,nostalgic}.mp3`. Client plays under narration. Voice delivery stays unique via per-story TTS tone instructions even when the bed is from the small library.
4. **Agent adjust** – Curator Realtime tool `set_curate_choice` patches mood/tone; changing mood clears a unique bed so the new library mood applies. User steers by conversation (no chip grid).
5. **Voice** – Enrolled clone (`UserVoice.elevenlabs_voice_id`, `clone_status=ready`) is used for Listen/share TTS. Failures fall back to OpenAI TTS with an explicit note header — never silent pretend.

## Configuration

| Service | Purpose | Env |
|---------|---------|-----|
| ElevenLabs Music | Unique generative beds | `ELEVENLABS_API_KEY` (Music credits required) |
| ElevenLabs TTS | Cloned narration voice | same key |
| OpenAI | Curate pick + music prompt + TTS fallback | `OPENAI_API_KEY` |
| Azure Blob | Store generated BGM | `AZURE_STORAGE_*` |

Without ElevenLabs Music credits / Azure, Curate still works with library beds + agent-led tone/music picks.

## API

- **POST /library/stories/{id}/curate/suggest** – auto-apply (or return current) curation; optional background generate.
- **GET /library/stories/{id}/preview** – `bgm_track`, optional `bgm_url`, voice enrollment snapshot.
- **GET /library/stories/{id}/narration** – MP3; headers `X-Narration-Voice` (`cloned` \| `default` \| `default_fallback`), optional `X-Narration-Note`.

## Legacy

Older Shared Memories docs referenced **POST /voice/narrate/bgm** and `narrate_bgm_cache` (moments). That path is superseded by story Curate + `story_bgm_cache`.
