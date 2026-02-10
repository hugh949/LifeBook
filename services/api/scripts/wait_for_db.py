#!/usr/bin/env python3
"""Wait for PostgreSQL to accept connections. Used at container startup so migrations run after DB is ready."""
import os
import sys
import time


def _normalize_db_url(url: str) -> str:
    """Ensure postgresql URLs use sslmode=require (Azure and most cloud Postgres enforce TLS)."""
    if not url or "postgresql" not in url:
        return url
    if "sslmode" in url:
        return url
    return url + ("?sslmode=require" if "?" not in url else "&sslmode=require")


def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        print("wait_for_db: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)
    database_url = _normalize_db_url(database_url)
    max_attempts = 30
    for attempt in range(1, max_attempts + 1):
        try:
            import psycopg
            with psycopg.connect(database_url, connect_timeout=2) as conn:
                conn.execute("SELECT 1")
            print(f"wait_for_db: database ready after {attempt} attempt(s)")
            return
        except Exception as e:
            if attempt == max_attempts:
                print(f"wait_for_db: gave up after {max_attempts} attempts: {e}", file=sys.stderr)
                # Stay up briefly so Azure can capture logs (no running replica = no console logs)
                time.sleep(30)
                sys.exit(1)
            print(f"wait_for_db: attempt {attempt}/{max_attempts} failed: {e}", file=sys.stderr)
            time.sleep(1)
    sys.exit(1)

if __name__ == "__main__":
    main()
