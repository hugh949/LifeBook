#!/usr/bin/env python3
"""
Dump a log report for debugging cloned voice usage on shared stories (e.g. Azure).

Use against the Azure database by setting DATABASE_URL to the Azure Postgres connection
string. Run from services/api (repo root won't work - script needs app package):

  cd services/api
  DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" \\
  uv run python scripts/dump_narration_voice_log.py --name Harry

Or run from the API container in Azure (same env as the app):

  python /app/scripts/dump_narration_voice_log.py --name Harry

Output: human-readable log dump showing whether clone voice is configured and would
be used for each shared story by the given participant (e.g. Harry).

Save to a file for Azure (from services/api):

  uv run python scripts/dump_narration_voice_log.py --name Harry > azure_harry_narration.log 2>&1
"""
import argparse
import os
import sys

from app.core.config import DEFAULT_FAMILY_ID, settings
from app.db.session import SessionLocal
from app.db import models


def dump_log(db, participant_name: str) -> None:
    """Dump narration-voice diagnostic log for participant (e.g. Harry)."""
    name_lower = participant_name.strip().lower()
    participants = [
        p
        for p in db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .all()
        if name_lower in (p.label or "").lower()
    ]

    # Environment (no secrets)
    elevenlabs_configured = bool((getattr(settings, "elevenlabs_api_key", None) or "").strip())
    database_url_set = bool((getattr(settings, "database_url", None) or "").strip())

    print("=" * 70)
    print("NARRATION VOICE LOG DUMP (clone voice for shared stories)")
    print("=" * 70)
    print(f"Participant filter: {participant_name!r} (case-insensitive contains)")
    print(f"ELEVENLABS_API_KEY set: {elevenlabs_configured}")
    print(f"DATABASE_URL set: {database_url_set}")
    print()

    if not participants:
        print(f"No participants found matching {participant_name!r}.")
        return

    # All shared story moments (voice_story, shared_at not null)
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
        consent_at = getattr(p, "elevenlabs_voice_consent_at", None)

        print("-" * 70)
        print(f"PARTICIPANT: {label}")
        print(f"  id: {pid}")
        print(f"  elevenlabs_voice_id: {elevenlabs_id or '(none)'}")
        print(f"  elevenlabs_voice_consent_at: {consent_at}")
        if elevenlabs_id and elevenlabs_configured:
            print("  → Clone voice WOULD be used for narration (if participant_id is sent to /narrate)")
        elif elevenlabs_id and not elevenlabs_configured:
            print("  → Clone voice NOT used: ELEVENLABS_API_KEY not set in this environment")
        else:
            print("  → Clone voice NOT used: no elevenlabs_voice_id for this participant")
        print()

        # Stories shared by this participant: moment.participant_id == pid or voice_story.participant_id == pid
        stories_for_participant = []
        for m in shared_moments:
            mid = str(m.id)
            m_pid = str(m.participant_id) if m.participant_id else None
            if m_pid == pid:
                stories_for_participant.append((m, m_pid, "moment.participant_id"))
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
                stories_for_participant.append(
                    (m, m_pid or "(null)", "voice_story.participant_id" + (" (moment.participant_id missing)" if not m_pid else ""))
                )

        print(f"SHARED STORIES BY THIS PARTICIPANT: {len(stories_for_participant)}")
        for m, m_pid, source in stories_for_participant:
            mid = str(m.id)
            title = (m.title or "").strip() or "(no title)"
            # When playback/narrate runs, participant_id sent to /narrate comes from moment.participant_id (or backfill from VoiceStory)
            effective_pid = str(m.participant_id) if m.participant_id else None
            if not effective_pid:
                story_for_pid = (
                    db.query(models.VoiceStory)
                    .filter(
                        models.VoiceStory.shared_moment_id == m.id,
                        models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
                    )
                    .first()
                )
                if story_for_pid and story_for_pid.participant_id:
                    effective_pid = str(story_for_pid.participant_id)

            clone_used = (
                elevenlabs_configured
                and elevenlabs_id
                and effective_pid == pid
            )
            print(f"  moment_id: {mid}")
            print(f"  title: {title!r}")
            print(f"  moment.participant_id: {m_pid}")
            print(f"  effective participant_id (for /narrate): {effective_pid or '(null)'}")
            print(f"  source: {source}")
            print(f"  clone voice used for this story: {'YES' if clone_used else 'NO'}")
            print()
        if not stories_for_participant:
            print("  (none)")
            print()

    print("=" * 70)
    print("END LOG DUMP")
    print("=" * 70)


def main():
    parser = argparse.ArgumentParser(
        description="Dump narration voice log for a participant (e.g. Harry) for use against Azure DB"
    )
    parser.add_argument(
        "--name",
        default="Harry",
        help="Participant name (case-insensitive contains). Default: Harry",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        dump_log(db, args.name)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
