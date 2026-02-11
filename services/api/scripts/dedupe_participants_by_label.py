#!/usr/bin/env python3
"""
Merge duplicate voice participants that share the same label (e.g. multiple "New User" rows).
For each label that appears more than once, we keep the oldest participant (by created_at)
and reassign all related data (moments, voice_stories, shared_story_listens) to that id,
then delete the duplicate participant rows.

Use when: you have many duplicate "New User" (or other same-name) participants and want
one participant per display name. Back up the database first.

Run from services/api with production DATABASE_URL:
  DATABASE_URL='postgresql://...' uv run python scripts/dedupe_participants_by_label.py --list
  DATABASE_URL='postgresql://...' uv run python scripts/dedupe_participants_by_label.py --confirm
"""
import argparse
import sys
from collections import defaultdict

from app.core.config import DEFAULT_FAMILY_ID
from app.db.session import SessionLocal
from app.db import models


def list_duplicates(db):
    """Show participants grouped by label; highlight labels that have duplicates."""
    rows = (
        db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .order_by(models.VoiceParticipant.label, models.VoiceParticipant.created_at)
        .all()
    )
    by_label = defaultdict(list)
    for p in rows:
        by_label[p.label].append(p)
    print("Participants by label (default family):")
    for label in sorted(by_label.keys()):
        participants = by_label[label]
        dup = "  [DUPLICATES - run with --confirm to merge]" if len(participants) > 1 else ""
        print(f"  {label!r}: {len(participants)} participant(s){dup}")
        for p in participants:
            print(f"    id={p.id}  created_at={p.created_at}")
    return by_label


def dedupe(db):
    """For each label with multiple participants, keep oldest and reassign FKs then delete duplicates."""
    rows = (
        db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .order_by(models.VoiceParticipant.label, models.VoiceParticipant.created_at)
        .all()
    )
    by_label = defaultdict(list)
    for p in rows:
        by_label[p.label].append(p)

    total_deleted = 0
    for label, participants in by_label.items():
        if len(participants) <= 1:
            continue
        # Keep first (oldest by created_at), merge the rest into it
        keep = participants[0]
        dups = participants[1:]
        kept_id = keep.id
        dup_ids = [p.id for p in dups]
        print(f"Merging {len(dups)} duplicate(s) for label {label!r} into id={kept_id}")

        # 1. Moments: point to kept participant
        n_moments = (
            db.query(models.Moment)
            .filter(models.Moment.participant_id.in_(dup_ids))
            .update({models.Moment.participant_id: kept_id}, synchronize_session=False)
        )
        if n_moments:
            print(f"  moments: reassigned {n_moments} to {kept_id}")

        # 2. VoiceStory: point to kept participant
        n_stories = (
            db.query(models.VoiceStory)
            .filter(models.VoiceStory.participant_id.in_(dup_ids))
            .update({models.VoiceStory.participant_id: kept_id}, synchronize_session=False)
        )
        if n_stories:
            print(f"  voice_stories: reassigned {n_stories} to {kept_id}")

        # 3. SharedStoryListen: (participant_id, moment_id) is PK. Reassign where possible;
        #    if (kept_id, moment_id) already exists, delete the dup row.
        for dup_id in dup_ids:
            listens = (
                db.query(models.SharedStoryListen)
                .filter(models.SharedStoryListen.participant_id == dup_id)
                .all()
            )
            for listen in listens:
                existing = (
                    db.query(models.SharedStoryListen).filter(
                        models.SharedStoryListen.participant_id == kept_id,
                        models.SharedStoryListen.moment_id == listen.moment_id,
                    ).first()
                )
                if existing:
                    db.delete(listen)
                else:
                    listen.participant_id = kept_id
                    db.add(listen)
        db.flush()

        # 4. Delete duplicate participants
        n_del = (
            db.query(models.VoiceParticipant)
            .filter(
                models.VoiceParticipant.id.in_(dup_ids),
                models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
            )
            .delete(synchronize_session=False)
        )
        total_deleted += n_del
        print(f"  deleted {n_del} duplicate participant(s)")

    return total_deleted


def main():
    parser = argparse.ArgumentParser(
        description="Merge duplicate participants with the same label (e.g. multiple 'New User'). Keeps oldest per label."
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="List participants by label and show which have duplicates (no changes)",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually merge duplicates and delete extra participant rows",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.list:
            list_duplicates(db)
            return

        if not args.confirm:
            by_label = list_duplicates(db)
            dup_count = sum(1 for participants in by_label.values() if len(participants) > 1)
            if dup_count > 0:
                print("\nRun with --confirm to merge duplicates.", file=sys.stderr)
            sys.exit(0 if dup_count == 0 else 1)

        deleted = dedupe(db)
        db.commit()
        print(f"Done. Deleted {deleted} duplicate participant(s).")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
