#!/usr/bin/env python3
"""
Hard-delete all shared voice story moments (Shared Memories) for the default family.
Removes rows in FK-safe order: SharedStoryListen, Transcript, MomentAsset, MomentPerson,
unlinks VoiceStory (shared_moment_id=null, status=final), then deletes Moment rows.
Participants and other data are unchanged.

Use when: starting with a clean Shared Memories list in production. Back up the DB first.

Run from services/api with production DATABASE_URL:
  DATABASE_URL='postgresql://...' uv run python scripts/clear_shared_memories.py --confirm
"""
import argparse
import sys

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def clear_shared_memories(db):
    """Hard-delete all shared voice story moments (default family) and dependent rows."""
    moment_ids = [
        r[0]
        for r in db.query(models.Moment.id).filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
        ).all()
    ]
    if not moment_ids:
        print("  No shared voice story moments found.")
        return 0

    total = 0

    # 1. shared_story_listens (references moments)
    n = db.query(models.SharedStoryListen).filter(
        models.SharedStoryListen.moment_id.in_(moment_ids)
    ).delete(synchronize_session=False)
    print(f"  shared_story_listens: {n}")
    total += n

    # 2. transcripts (references moments)
    n = db.query(models.Transcript).filter(
        models.Transcript.moment_id.in_(moment_ids)
    ).delete(synchronize_session=False)
    print(f"  transcripts: {n}")
    total += n

    # 3. moment_assets
    n = db.query(models.MomentAsset).filter(
        models.MomentAsset.moment_id.in_(moment_ids)
    ).delete(synchronize_session=False)
    print(f"  moment_assets: {n}")
    total += n

    # 4. moment_people
    n = db.query(models.MomentPerson).filter(
        models.MomentPerson.moment_id.in_(moment_ids)
    ).delete(synchronize_session=False)
    print(f"  moment_people: {n}")
    total += n

    # 5. Unlink voice_stories (set shared_moment_id=null, status=final so story stays in Recall)
    stories = db.query(models.VoiceStory).filter(
        models.VoiceStory.shared_moment_id.in_(moment_ids),
        models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
    ).all()
    for s in stories:
        s.shared_moment_id = None
        s.status = "final"
        db.add(s)
    print(f"  voice_stories unlinked: {len(stories)}")
    total += len(stories)
    db.flush()  # ensure UPDATE is applied before we delete moments (avoids FK violation)

    # 6. Delete the moments
    n = db.query(models.Moment).filter(
        models.Moment.id.in_(moment_ids)
    ).delete(synchronize_session=False)
    print(f"  moments (hard-deleted): {n}")
    total += n

    return n


def main():
    parser = argparse.ArgumentParser(
        description="Hard-delete all shared voice stories (Shared Memories) for the default family."
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required: confirm you want to clear shared memories (otherwise script does nothing)",
    )
    args = parser.parse_args()

    if not args.confirm:
        print("Run with --confirm to clear all shared memories.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        print("Hard-deleting shared memories for default family...")
        count = clear_shared_memories(db)
        db.commit()
        print(f"Done. Removed {count} shared voice story moment(s) and dependent rows.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
