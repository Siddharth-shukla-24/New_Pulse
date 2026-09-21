"""Postgres helpers shared by the pipeline."""
from pathlib import Path

import psycopg2

import config

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "db" / "schema.sql"
ADVISORY_LOCK_KEY = 727001


class PipelineBusy(RuntimeError):
    """Raised when another pipeline run already holds the advisory lock."""


def connect():
    if not config.DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set")
    return psycopg2.connect(config.DATABASE_URL, connect_timeout=15)


def ensure_schema(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
    conn.commit()


def try_lock(conn) -> bool:
    """Session-level advisory lock; released automatically when the connection closes."""
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (ADVISORY_LOCK_KEY,))
        acquired = bool(cur.fetchone()[0])
    conn.commit()
    return acquired