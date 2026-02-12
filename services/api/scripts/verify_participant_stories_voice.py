#!/usr/bin/env python3
"""
Verify that all shared stories for a participant (e.g. Harry) use the same cloned voice.

Checks:
1. Only one participant with that name (or list all matches and their elevenlabs_voice_id).
2. For each shared story: moment_id, title, participant_id, stored audio (asset) if any and when created.
3. Optional: call POST /voice/narrate for each story and report X-Narration-Voice (cloned vs default).

For Azure: use --azure-db so the script loads DATABASE_URL from repo root .env.azure (no shell env confusion).

  cd services/api
  uv run python scripts/verify_participant_stories_voice.py --name Harry --azure-db --api-base https://...

  Or from repo root: ./scripts/azure-api-status.sh narrate-verify Harry
"""
import argparse
import json
import ssl
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# Load .env.azure *before* importing app, so DATABASE_URL is set for Azure (avoids local .env / host "db")
if "--azure-db" in sys.argv:
    sys.argv.remove("--azure-db")
    import os as _os
    _env_azure = Path(_os.environ.get("AZURE_ENV_PATH", "")).resolve()
    if not _env_azure.is_file():
        _env_azure = Path.cwd().resolve().parent / ".env.azure"
    if not _env_azure.is_file():
        _env_azure = Path(__file__).resolve().parents[2] / ".env.azure"
    if not _env_azure.is_file():
        print("Missing .env.azure. Set AZURE_ENV_PATH or run from repo root (e.g. ./scripts/azure-api-status.sh narrate-verify Harry).", file=sys.stderr)
        sys.exit(1)
    from dotenv import load_dotenv
    load_dotenv(_env_azure)

from app.core.config import DEFAULT_FAMILY_ID, settings
from app.db.session import SessionLocal
from app.db import models


def get_asset_created_at(db, asset_id: str | None):
    if not asset_id:
        return None
    a = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    return a.created_at if a else None


def verify(db, participant_name: str, api_base: str | None, no_verify_ssl: bool = False) -> None:
    name_lower = participant_name.strip().lower()
    participants = [
        p
        for p in db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .all()
        if name_lower in (p.label or "").lower()
    ]

    print("=" * 72)
    print("VERIFY PARTICIPANT SHARED STORIES – SAME CLONE VOICE?")
    print("=" * 72)
    print(f"Participant filter: {participant_name!r}")
    if api_base:
        print(f"Live narrate check: POST {api_base.rstrip('/')}/voice/narrate")
    else:
        print("Live narrate check: (omit --api-base to skip)")
    print()

    if not participants:
        all_participants = (
            db.query(models.VoiceParticipant)
            .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
            .all()
        )
        print(f"No participants found matching {participant_name!r}.")
        if all_participants:
            print("Participants in this DB (try one of these names):")
            for p in all_participants:
                print(f"  - {p.label!r} (id={p.id})")
        else:
            print("This DB has no voice participants.")
        return

    # Multiple participants with same name could mean two different clones
    if len(participants) > 1:
        print("WARNING: Multiple participants match this name (different clones possible):")
        for p in participants:
            vid = (getattr(p, "elevenlabs_voice_id", None) or "").strip() or "(none)"
            print(f"  - id={p.id} label={p.label!r} elevenlabs_voice_id={vid}")
        print()

    shared_moments = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
            models.Moment.deleted_at.is_(None),
        )
        .all()
    )

    for p in participants:
        pid = str(p.id)
        label = (p.label or "").strip() or "(no label)"
        elevenlabs_id = (getattr(p, "elevenlabs_voice_id", None) or "").strip() or None

        # This participant's shared stories
        stories_for_participant = []
        for m in shared_moments:
            mid = str(m.id)
            m_pid = str(m.participant_id) if m.participant_id else None
            if m_pid == pid:
                stories_for_participant.append(m)
                continue
            story = (
                db.query(models.VoiceStory)
                .filter(
                    models.VoiceStory.shared_moment_id == m.id,
                    models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
                )
                .first()
            )
            if story and str(story.participant_id) == pid:
                stories_for_participant.append(m)

        print("-" * 72)
        print(f"PARTICIPANT: {label} (id={pid})")
        print(f"  elevenlabs_voice_id: {elevenlabs_id or '(none)'}")
        print(f"  Shared stories: {len(stories_for_participant)}")
        print()

        for m in stories_for_participant:
            mid = str(m.id)
            title = (m.title or "").strip() or "(no title)"
            # VoiceStory for this moment
            story = (
                db.query(models.VoiceStory)
                .filter(
                    models.VoiceStory.shared_moment_id == mid,
                    models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
                )
                .first()
            )
            final_asset_id = str(story.final_audio_asset_id) if story and story.final_audio_asset_id else None
            # Moment's session_audio asset (what playback URL serves)
            ma = (
                db.query(models.MomentAsset)
                .filter(
                    models.MomentAsset.moment_id == mid,
                    models.MomentAsset.role == "session_audio",
                )
                .first()
            )
            playback_asset_id = str(ma.asset_id) if ma else None
            playback_created = get_asset_created_at(db, ma.asset_id if ma else None) if ma else None

            text_for_narrate = (m.summary or "").strip() or (title or "Test.")[:500]
            if not text_for_narrate:
                text_for_narrate = "Test."

            print(f"  Story: {title!r}")
            print(f"    moment_id: {mid}")
            print(f"    participant_id: {pid}")
            print(f"    voice_story.final_audio_asset_id: {final_asset_id or '(none)'}")
            print(f"    playback asset (session_audio): {playback_asset_id or '(none)'}")
            if playback_created:
                print(f"    playback asset created_at: {playback_created}")
            if not playback_asset_id:
                print("    → No stored audio; only live Narrate is used (always uses participant_id → clone).")

            # Live narrate check
            if api_base:
                url = f"{api_base.rstrip('/')}/voice/narrate"
                payload = {"text": text_for_narrate[:2000], "participant_id": pid}
                try:
                    req = Request(url, data=json.dumps(payload).encode("utf-8"), method="POST")
                    req.add_header("Content-Type", "application/json")
                    ctx = None
                    if no_verify_ssl:
                        ctx = ssl.create_default_context()
                        ctx.check_hostname = False
                        ctx.verify_mode = ssl.CERT_NONE
                    with urlopen(req, timeout=30, context=ctx) as resp:
                        voice_header = resp.headers.get("X-Narration-Voice", "").strip()
                        print(f"    POST /voice/narrate → X-Narration-Voice: {voice_header or '(not set)'}")
                        if voice_header == "cloned":
                            print("    → Live narrate uses CLONED voice for this story.")
                        elif voice_header == "default":
                            print("    → Live narrate uses DEFAULT voice (not clone) for this story.")
                except (HTTPError, URLError, OSError) as e:
                    print(f"    POST /voice/narrate → error: {e}")
            print()

        # Summary
        print("  Summary:")
        if len(participants) > 1:
            print("    - Multiple participants with this name: possible different clones per story if moments point to different participant_ids.")
        if elevenlabs_id:
            print("    - One elevenlabs_voice_id for this participant; live Narrate should use same clone for all stories.")
        else:
            print("    - No clone for this participant; live Narrate uses default voice.")
        print("    - If one story sounds different: it may be playing STORED audio (Play button) from when the asset was created (e.g. before clone existed). Use Narrate for consistent clone.")
        print()

    print("=" * 72)
    print("END VERIFY")
    print("=" * 72)


def main():
    parser = argparse.ArgumentParser(
        description="Verify all shared stories for a participant use the same clone voice"
    )
    parser.add_argument("--name", default="Harry", help="Participant name (case-insensitive contains)")
    parser.add_argument(
        "--api-base",
        default=None,
        help="API base URL to call POST /voice/narrate per story and report X-Narration-Voice",
    )
    parser.add_argument(
        "--no-verify-ssl",
        action="store_true",
        help="Skip SSL verification for narrate requests (use if you get CERTIFICATE_VERIFY_FAILED)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        verify(db, args.name, args.api_base, no_verify_ssl=args.no_verify_ssl)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
