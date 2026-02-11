#!/usr/bin/env python3
"""
Clear the recall pass code for a single participant (e.g. when they forget it).
After running, that participant will have no recall code set; they can set a new one
from the Voice session page (Set code / Change code).

Use on production only when necessary. Prefer having the user try "Change code" with
their old code first; if they truly forgot it, run this script then they set a new code.

Run from services/api with production DATABASE_URL:
  DATABASE_URL='postgresql://...' uv run python scripts/clear_recall_passcode.py --participant-id <uuid> --confirm

To list participants (to find the right id):
  DATABASE_URL='postgresql://...' uv run python scripts/clear_recall_passcode.py --list
"""
import argparse
import sys

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def list_participants(db):
    """Print all voice participants and whether they have a recall code set."""
    rows = (
        db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .order_by(models.VoiceParticipant.label)
        .all()
    )
    if not rows:
        print("  No participants found.")
        return
    print("Participants (default family):")
    for p in rows:
        has_code = bool(getattr(p, "recall_passphrase", None) and str(p.recall_passphrase).strip())
        print(f"  id={p.id}  label={p.label!r}  recall_passphrase_set={has_code}")
    print("Use: --participant-id <id> --confirm to clear that participant's recall code.")


def clear_recall_passcode(db, participant_id: str) -> bool:
    """Set recall_passphrase to NULL for the given participant. Returns True if updated."""
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        return False
    had_code = bool(getattr(participant, "recall_passphrase", None) and str(participant.recall_passphrase).strip())
    participant.recall_passphrase = None
    db.add(participant)
    return had_code


def main():
    parser = argparse.ArgumentParser(
        description="Clear the recall pass code for one participant (e.g. when they forget it)."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List all participants and whether they have a recall code set (no changes made)",
    )
    parser.add_argument(
        "--participant-id",
        metavar="UUID",
        help="Participant id (from --list or app) to clear recall code for",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Required to actually clear the code (safety check)",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.list:
            list_participants(db)
            return

        if not args.participant_id:
            print("Either use --list to see participants, or provide --participant-id <uuid>.", file=sys.stderr)
            sys.exit(1)
        if not args.confirm:
            print("Add --confirm to clear the recall code for this participant.", file=sys.stderr)
            sys.exit(1)

        updated = clear_recall_passcode(db, args.participant_id)
        if not updated:
            # Check if participant exists at all
            exists = (
                db.query(models.VoiceParticipant)
                .filter(
                    models.VoiceParticipant.id == args.participant_id,
                    models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
                )
                .first()
            )
            if not exists:
                print(f"Participant not found: {args.participant_id}", file=sys.stderr)
                sys.exit(1)
            print("Participant had no recall code set; nothing to clear.")
        else:
            db.commit()
            print(f"Recall pass code cleared for participant {args.participant_id}. They can set a new code from the app.")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
