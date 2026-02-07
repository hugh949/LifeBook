# Repo Scaffold — Next.js (SSR) + FastAPI + Postgres + Azure Blob (SAS) + OpenAI Realtime

## 0) Monorepo layout (recommended)

lifebook-v1/
  README.md
  V1_Product_Spec.md
  Azure_Deployment_Appendix.md
  Product_Vision_Roadmap.md
  Repo_Scaffold.md
  .env.example
  docker-compose.yml

  apps/
    web/                         # Next.js SSR app (App Service)
      package.json
      next.config.js
      tsconfig.json
      .env.local.example
      src/
        app/                     # Next.js App Router
          layout.tsx
          page.tsx               # /
          older/page.tsx         # /older
          older/session/page.tsx # /older/session
          family/page.tsx        # /family
          family/upload/page.tsx # /family/upload
          bank/page.tsx          # /bank
          m/[momentId]/page.tsx  # /m/:momentId  (SSR share)
          p/[personId]/page.tsx  # /p/:personId  (SSR)
          invite/[token]/page.tsx# /invite/:token (SSR)
        components/
          ui/
          audio/
          trailer/
          bank/
        lib/
          api.ts                 # typed API client
          auth.ts                # session helpers
          media.ts               # upload helpers (SAS)
          i18n.ts                # language constants
          realtime.ts            # OpenAI Realtime WebRTC client wrapper
        public/
          music/                 # V1: small royalty-free tracks
      middleware.ts              # auth gating (optional)

  services/
    api/                         # FastAPI (Container Apps)
      Dockerfile
      pyproject.toml             # or requirements.txt
      alembic.ini
      alembic/
        versions/
      app/
        main.py
        core/
          config.py              # env + settings
          cors.py
        db/
          session.py
          models.py
        routers/
          health.py
          media.py               # /media/sas, /media/complete
          realtime.py            # /realtime/token
          sessions.py            # /sessions/complete
          moments.py
          people.py
        services/
          storage_blob.py        # Azure Blob SAS generation
          ai_pipeline.py         # transcribe/summarize/tag/translate
        schemas/
          media.py
          moment.py
          people.py

## 1) Local development (Docker Compose)

Use `docker compose up --build` to start:
- Postgres on `localhost:5432`
- API on `localhost:8000`
- Web on `localhost:3000`

## 2) Minimal API request/response examples

### POST /media/sas
Request:
{
  "type": "photo",
  "contentType": "image/jpeg",
  "fileName": "grandpa_1972.jpg"
}
Response:
{
  "uploadUrl": "https://...SAS...",
  "blobUrl": "https://<account>.blob.core.windows.net/photos/<path>",
  "expiresAt": "2026-02-06T22:00:00Z"
}

### POST /media/complete
Request:
{
  "blobUrl": "https://<account>.blob.core.windows.net/photos/<path>",
  "type": "photo",
  "metadata": { "source": "family_upload" }
}
Response:
{ "assetId": "uuid" }
