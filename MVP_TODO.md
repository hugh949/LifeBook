# MVP TODO (first 10 tasks)

1) API: include routers in app.main (media, realtime, sessions) and verify /health
2) DB: add SQLAlchemy models + Alembic migration for Families/Users/Assets/Moments/Transcripts
3) API: implement /media/sas (Azure Blob SAS for PUT)
4) API: implement /media/complete (create Asset record)
5) Web: implement Family Upload page using SAS flow (PUT + complete)
6) Web: implement /bank timeline fetching from API
7) API: implement Moments CRUD (create/list/get)
8) API: implement /realtime/token (ephemeral token/config)
9) Web: implement /older/session Realtime audio loop (mic stream + play assistant)
10) API: implement post-processing pipeline stub (transcribe/summarize/tag/translate) and save Transcript/Moment fields
