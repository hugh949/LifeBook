# Narration background music (Shared Memories)

When a user taps **Narrate Story** in Shared Memories, the app plays TTS narration with **synthetically generated** background music that is unique per story, culture- and language-aware, and fits the narrative.

## How it works

1. **BGM request** – Frontend calls **POST /voice/narrate/bgm** with `{ moment_id, text }` in parallel with TTS.
2. **Cache** – If this moment already has generated BGM, the API returns a signed playback URL immediately.
3. **Cache miss** – The backend:
   - Uses the LLM to produce a **music generation prompt** from the full story (instruments, mood, tempo, cultural/language context; always includes "instrumental only", "no vocals", "suitable for voiceover").
   - Calls **ElevenLabs Music API** (`POST https://api.elevenlabs.io/v1/music`) with that prompt to generate ~60s of instrumental audio (MP3).
   - Uploads the audio to **Azure Blob** (audio container), creates an **Asset** record, and stores the mapping in **narrate_bgm_cache** (moment_id → asset_id).
   - Returns a signed playback URL.
4. **Playback** – Frontend plays TTS and BGM together (BGM at 0.2 volume, looped). If the BGM endpoint returns `url: null`, narration plays without music.

## Loudness (LUFS)

Narration and BGM are normalized to consistent loudness so the voice sits clearly above the music:

- **Narration (OpenAI TTS):** **-16 LUFS** (integrated loudness). Applied to the TTS response before returning.
- **Music (ElevenLabs BGM):** **-24 LUFS**. Applied to the generated BGM before upload to Azure.

Normalization is done with ffmpeg’s `loudnorm` filter. If ffmpeg is unavailable, the API returns the original audio unchanged.

## External services

| Service      | Purpose                    | Env var               |
|-------------|----------------------------|------------------------|
| ElevenLabs  | Music generation (Music API) | `ELEVENLABS_API_KEY` |
| OpenAI      | Music prompt from story    | `OPENAI_API_KEY`      |
| Azure Blob  | Store generated audio      | `AZURE_STORAGE_*`     |

## Configuration

- **ELEVENLABS_API_KEY** – Required for BGM generation. Get an API key from [ElevenLabs](https://elevenlabs.io). Auth header: `xi-api-key`. If unset, the BGM endpoint returns `{ "url": null }` and narration plays without music.
- **Azure storage** – Must be configured to store generated BGM. If not set, generation runs but upload is skipped and the API returns `url: null`.

## API

- **POST /voice/narrate/bgm** – Body: `{ "moment_id": "<uuid>", "text": "full story narration" }`. Returns `{ "url": "<signed playback URL>" }` or `{ "url": null }` on failure or when ElevenLabs/Azure are not configured. Cached per moment_id.
- **POST /voice/narrate/mood** – Deprecated. Previously returned a static track id for curated BGM; use `/narrate/bgm` for synthetic BGM.

## Latency and cost

- **First narration of a story:** BGM generation can take ~30–90s (LLM prompt 2–5s, ElevenLabs Music 30–90s, upload 2–5s). Frontend waits for both TTS and BGM in parallel, so total wait is roughly max(TTS, BGM).
- **Subsequent narrations:** BGM is cached; only TTS is requested (~5–15s).
- **Cost:** ElevenLabs Music API usage per generation; OpenAI prompt ~\$0.001; Azure storage minimal.

## Database

- **narrate_bgm_cache** – Table: `moment_id` (PK), `asset_id` (FK to assets), `created_at`. One row per moment that has generated BGM.
