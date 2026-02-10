#!/usr/bin/env python3
"""
One-off script to wipe all voice participants, users, people, moments, assets,
voice stories, and related rows for the default family.

Use when: (1) this major release—replacing old production app and a clean DB is
acceptable; (2) first production launch (empty DB); (3) rare case where migration
is not possible. For future releases, prefer preserving data; do not wipe unless
necessary. Back up the database first.

Run from services/api with: uv run python scripts/wipe_all_participants_and_data.py --confirm
"""
import argparse
import sys

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def wipe(db):
    """Delete all participant and related data for the default family in FK-safe order."""
    participant_ids = [
        r[0]
        for r in db.query(models.VoiceParticipant.id).filter(
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID
        ).all()
    ]
    moment_ids = [
        r[0]
        for r in db.query(models.Moment.id).filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID
        ).all()
    ]

    total = 0

    # 1. shared_story_listens (references voice_participants, moments)
    if participant_ids:
        n = db.query(models.SharedStoryListen).filter(
            models.SharedStoryListen.participant_id.in_(participant_ids)
        ).delete(synchronize_session=False)
        print(f"  shared_story_listens: {n}")
        total += n
    else:
        print("  shared_story_listens: 0")

    # 2. voice_stories (references voice_participants, moments, assets)
    n = db.query(models.VoiceStory).filter(
        models.VoiceStory.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  voice_stories: {n}")
    total += n

    # 3. transcripts (references moments, assets)
    if moment_ids:
        n = db.query(models.Transcript).filter(
            models.Transcript.moment_id.in_(moment_ids)
        ).delete(synchronize_session=False)
        print(f"  transcripts: {n}")
        total += n
    else:
        print("  transcripts: 0")

    # 4. moment_assets
    if moment_ids:
        n = db.query(models.MomentAsset).filter(
            models.MomentAsset.moment_id.in_(moment_ids)
        ).delete(synchronize_session=False)
        print(f"  moment_assets: {n}")
        total += n
    else:
        print("  moment_assets: 0")

    # 5. moment_people
    if moment_ids:
        n = db.query(models.MomentPerson).filter(
            models.MomentPerson.moment_id.in_(moment_ids)
        ).delete(synchronize_session=False)
        print(f"  moment_people: {n}")
        total += n
    else:
        print("  moment_people: 0")

    # 6. moments
    n = db.query(models.Moment).filter(
        models.Moment.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  moments: {n}")
    total += n

    # 7. assets (family-scoped; blobs in Azure are unchanged)
    n = db.query(models.Asset).filter(
        models.Asset.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  assets: {n}")
    total += n

    # 8. voice_participants
    n = db.query(models.VoiceParticipant).filter(
        models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  voice_participants: {n}")
    total += n

    # 9. users
    n = db.query(models.User).filter(
        models.User.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  users: {n}")
    total += n

    # 10. people
    n = db.query(models.Person).filter(
        models.Person.family_id == DEFAULT_FAMILY_ID
    ).delete(synchronize_session=False)
    print(f"  people: {n}")
    total += n

    return total


def main():
    parser = argparse.ArgumentParser(
        description="Wipe all participants and their data for the default family. Back up the DB first."
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: confirm you want to wipe (otherwise script does nothing)",
    )
    args = parser.parse_args()

    if not args.confirm:
        print("Run with --confirm to wipe all participant and related data.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        print("Wiping data for default family (FK-safe order)...")
        total = wipe(db)
        db.commit()
        print(f"Done. Total rows deleted: {total}")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
