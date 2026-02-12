#!/usr/bin/env python3
"""
Verify that a participant's cloned voice is properly linked for story narration.

Checks:
1. Participant exists and has elevenlabs_voice_id
2. Shared stories (moments) have participant_id pointing to the participant
3. The chain: Moment.participant_id -> VoiceParticipant.elevenlabs_voice_id is correct

Run from services/api: uv run python scripts/verify_voice_clone_narration.py [--name Harry]
"""
import argparse
import sys

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def verify(db, participant_name: str | None = None):
    """Verify voice clone → narration chain for participant(s)."""
    # Find participant(s) by name (case-insensitive contains)
    query = db.query(models.VoiceParticipant).filter(
        models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
    )
    if participant_name:
        # Case-insensitive match on label
        name_lower = participant_name.strip().lower()
        participants = [p for p in query.all() if name_lower in (p.label or "").lower()]
    else:
        participants = query.all()

    if not participants:
        print("No participants found" + (f" matching '{participant_name}'" if participant_name else ""))
        return 1

    ok_count = 0
    issue_count = 0

    for p in participants:
        pid = str(p.id)
        label = (p.label or "").strip() or "(no label)"
        elevenlabs_id = (getattr(p, "elevenlabs_voice_id", None) or "").strip() or None
        consent_at = getattr(p, "elevenlabs_voice_consent_at", None)

        print(f"\n--- Participant: {label} (id={pid}) ---")
        print(f"  elevenlabs_voice_id: {elevenlabs_id or '(none)'}")
        print(f"  elevenlabs_voice_consent_at: {consent_at}")

        if not elevenlabs_id:
            print("  ⚠️  NO CLONED VOICE - narration will use default AI voice")
            issue_count += 1
            # Still check stories for reference chain
        else:
            print("  ✓  Has cloned voice")
            ok_count += 1

        # Shared stories: moments with source=voice_story and shared_at set
        moments = (
            db.query(models.Moment)
            .filter(
                models.Moment.family_id == DEFAULT_FAMILY_ID,
                models.Moment.source == "voice_story",
                models.Moment.shared_at.isnot(None),
                models.Moment.deleted_at.is_(None),
            )
            .all()
        )

        # Filter to Harry's stories: moment.participant_id OR voice_story.participant_id
        harry_moments = []
        for m in moments:
            mid = str(m.id)
            m_participant = str(m.participant_id) if m.participant_id else None
            if m_participant == pid:
                harry_moments.append((m, "moment.participant_id"))
                continue
            # Backfill from VoiceStory if moment has no participant_id
            story = (
                db.query(models.VoiceStory)
                .filter(
                    models.VoiceStory.shared_moment_id == m.id,
                    models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
                )
                .first()
            )
            if story and str(story.participant_id) == pid:
                harry_moments.append((m, "voice_story.participant_id (moment.participant_id missing)"))
                if not m_participant:
                    print(f"  ⚠️  Story moment_id={mid} has no participant_id; backfilled from VoiceStory")
                    issue_count += 1

        if not harry_moments:
            print(f"  No shared stories found for this participant")
            continue

        print(f"  Shared stories: {len(harry_moments)}")
        for m, source in harry_moments:
            mid = str(m.id)
            m_pid = str(m.participant_id) if m.participant_id else None
            title = (m.title or "").strip() or "(no title)"
            print(f"    - moment_id={mid} title={title!r}")
            print(f"      participant_id={m_pid or '(NULL)'} (source: {source})")

            if m_pid != pid:
                print(f"      ⚠️  participant_id mismatch! Moment has {m_pid}, expected {pid}")
                print(f"      → Narration will NOT use cloned voice (wrong participant_id sent to API)")
                issue_count += 1
            elif elevenlabs_id:
                print(f"      ✓  Chain OK: moment.participant_id={pid} → participant.elevenlabs_voice_id={elevenlabs_id}")
                ok_count += 1
            else:
                print(f"      ⚠️  participant_id correct but no cloned voice - will use default")

    print("\n" + "=" * 60)
    if issue_count > 0:
        print(f"Found {issue_count} issue(s). Narration may not use cloned voice.")
        return 1
    print("All checks passed. Narration should use cloned voice when available.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="Verify voice clone → narration chain for a participant"
    )
    parser.add_argument(
        "--name",
        default="Harry",
        help="Participant name to check (case-insensitive contains). Default: Harry",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        return verify(db, args.name)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
