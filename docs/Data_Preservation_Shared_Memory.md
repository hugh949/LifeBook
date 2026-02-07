# Data preservation & shared memory (Azure)

LifeBook keeps **stories, voice recordings, past recordings, photos, and comments** in **Azure** so your family’s shared memory is durable, searchable, and replayable—the foundation for a reliable, “wow” experience.

---

## Where content lives

| Content | Stored in | Used for |
|--------|-----------|----------|
| **Photos** | **Azure Blob Storage** (container `photos`) | Thumbnails and full images; URLs in DB |
| **Voice / audio** | **Azure Blob Storage** (container `audio`) | Session recordings, voice notes; URLs in DB |
| **Stories, summaries, comments** | **Azure Database for PostgreSQL** | Moment title, summary, and appended comments (text) |
| **Transcripts** | **Azure Database for PostgreSQL** | What was said in voice sessions/notes (original + optional English) |
| **Metadata & links** | **Azure Database for PostgreSQL** | Moments, assets, moment–asset–person links, transcripts |

- **Postgres** holds all structured data: families, users, people, moments, assets (metadata and blob URLs), moment–asset links, and **transcripts**.
- **Blob** holds the binary files; the API issues short-lived signed URLs so the app can display or play them without exposing storage keys.

Nothing is kept only in memory or in the browser. Once saved, it’s in Azure and available for shared memory across the family.

---

## How it supports the “wow” experience

1. **Preserved** – Photos, voice, and stories are written to Azure and stay there across sessions and devices.
2. **Shared** – One family, one Memory Bank; everyone sees the same moments, assets, and transcripts (with more sharing controls later).
3. **Replayable** – Past voice sessions and voice notes are stored as audio (Blob) plus transcript (Postgres). The API returns `assets` (with signed `playback_url` for audio) and `transcripts` on **GET /moments/:id** so the UI can play recordings and show what was said.
4. **Searchable** – Moment title/summary and transcript text live in Postgres so you can add search (and later full-text or filters) without re-scanning files.

---

## API behavior that preserves shared memory

- **POST /media/sas** → **PUT blob** → **POST /media/complete**  
  Photos and audio are uploaded to Blob and registered in Postgres (asset row + optional moment link).

- **POST /moments**  
  Creates a moment (title, summary, tags) and links assets (e.g. hero photo, voice note). All in Postgres.

- **PATCH /moments/:id** with **add_comment**  
  Appends text to the moment’s summary in Postgres so comments become part of the story.

- **POST /sessions/complete**  
  Creates a moment for the voice session, links the session audio asset, and optionally stores a **transcript** (e.g. `transcriptText`, `transcriptLanguage`, `transcriptTextEn`) in the **transcripts** table. That way voice is preserved as both recording (Blob) and text (Postgres).

- **GET /moments/:id**  
  Returns the moment plus **assets** (photos with signed thumbnail/image URLs, audio with signed **playback_url**) and **transcripts** (id, asset_id, language, text, text_en, created_at). The frontend can show all media and past recordings with their text.

---

## Backups and durability (Azure)

- **Azure Database for PostgreSQL** and **Azure Blob Storage** provide redundancy and backup options (e.g. automated backups, geo-redundancy). Configure them in the Azure portal for your environment.
- LifeBook does not delete content on a schedule; deletion/retention policies can be added later (e.g. soft delete + scheduled hard delete per spec).

---

## Summary

Stories, voice recordings, past recordings, photos, and comments are **preserved in Azure** (Postgres + Blob). The API is built so that:

- Every saved piece of content is stored durably.
- Moment detail includes assets and transcripts for replay and display.
- Sessions can send transcripts to **POST /sessions/complete** so voice is stored as text as well as audio.

That’s the basis for a shared-memory, “wow” user experience on Azure.
