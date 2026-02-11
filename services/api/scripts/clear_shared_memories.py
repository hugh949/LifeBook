#!/usr/bin/env python3
"""
Soft-delete all shared voice stories (Shared Memories) for the default family.
Sets deleted_at on moments where source='voice_story' and shared_at is not null.
Participants and other data are unchanged; only the Shared Memories list is cleared.

Use when: starting with a clean Shared Memories list (e.g. after fixing participant_id
so new shares have correct author and delete works). Back up the database first if needed.

Run from services/api with: uv run python scripts/clear_shared_memories.py --confirm
"""
import argparse
import sys
from datetime import datetime, timezone

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def clear_shared_memories(db):
    """Set deleted_at on all shared voice story moments (default family)."""
    now = datetime.now(timezone.utc)
    count = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
            models.Moment.deleted_at.is_(None),
        )
        .update(
            {models.Moment.deleted_at: now},
            synchronize_session=False,
        )
    )
    return count


def main():
    parser = argparse.ArgumentParser(
        description="Soft-delete all shared voice stories (Shared Memories) for the default family."
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
        print("Clearing shared memories (soft-delete) for default family...")
        count = clear_shared_memories(db)
        db.commit()
        print(f"Done. Soft-deleted {count} shared voice story moment(s).")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
