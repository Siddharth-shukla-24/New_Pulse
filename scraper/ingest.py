"""Fetches feeds, dedupes against the DB, extracts bodies for NEW articles only, stores them."""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import feedparser
import requests

import config
from extract import fetch_article_body
from normalize import normalize_entry

log = logging.getLogger("ingest")

INSERT_SQL = """
INSERT INTO articles
  (url, url_hash, source, title, summary, body, published_at, published_inferred)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (url_hash) DO NOTHING
"""


def fetch_feed(feed: dict) -> list:
    resp = requests.get(
        feed["url"],
        headers={"User-Agent": config.USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
        timeout=config.FEED_TIMEOUT,
    )
    resp.raise_for_status()
    parsed = feedparser.parse(resp.content)
    if parsed.bozo and not parsed.entries:
        raise ValueError(f"unparseable feed: {parsed.bozo_exception}")
    now = datetime.now(timezone.utc)
    items = []
    for entry in parsed.entries[: config.MAX_ENTRIES_PER_FEED]:
        item = normalize_entry(entry, feed["source"], now)
        if item:
            items.append(item)
    return items


def existing_hashes(conn, hashes: list) -> set:
    if not hashes:
        return set()
    with conn.cursor() as cur:
        cur.execute("SELECT url_hash FROM articles WHERE url_hash = ANY(%s)", (hashes,))
        return {row[0] for row in cur.fetchall()}


def enrich_bodies(items: list) -> int:
    """Fetches article pages concurrently. Returns the number of pages that failed to parse."""
    failed = 0
    with ThreadPoolExecutor(max_workers=config.FETCH_WORKERS) as pool:
        futures = {pool.submit(fetch_article_body, it["url"]): it for it in items}
        for future in as_completed(futures):
            item = futures[future]
            try:
                body = future.result()
            except Exception:
                body = ""
            if not body:
                failed += 1
            item["body"] = body or item.get("feed_body", "")
    return failed


def insert_articles(conn, items: list) -> int:
    inserted = 0
    with conn.cursor() as cur:
        for it in items:
            cur.execute(
                INSERT_SQL,
                (
                    it["url"],
                    it["url_hash"],
                    it["source"],
                    it["title"],
                    it["summary"],
                    (it.get("body") or "").replace("\x00", ""),
                    it["published_at"],
                    it["published_inferred"],
                ),
            )
            inserted += cur.rowcount
    conn.commit()
    return inserted


def ingest_all(conn) -> dict:
    collected: dict = {}
    per_source: dict = {}
    feed_errors: list = []

    for feed in config.FEEDS:
        try:
            items = fetch_feed(feed)
        except Exception as exc:  # one bad feed must not abort the run
            log.error("Feed %s failed: %s", feed["source"], exc)
            feed_errors.append({"source": feed["source"], "error": str(exc)[:200]})
            continue
        per_source[feed["source"]] = len(items)
        for item in items:
            collected.setdefault(item["url_hash"], item)

    if len(feed_errors) == len(config.FEEDS):
        raise RuntimeError("All feeds failed to load")

    known = existing_hashes(conn, list(collected))
    fresh = [it for h, it in collected.items() if h not in known]
    fresh.sort(key=lambda it: it["published_at"], reverse=True)
    fresh = fresh[: config.MAX_NEW_ARTICLES]

    body_failed = enrich_bodies(fresh)
    inserted = insert_articles(conn, fresh)
    log.info(
        "Feeds: %s | fetched=%d new=%d inserted=%d body_failed=%d",
        per_source, len(collected), len(fresh), inserted, body_failed,
    )
    return {
        "fetched": len(collected),
        "new_articles": len(fresh),
        "inserted": inserted,
        "body_failed": body_failed,
        "per_source": per_source,
        "feed_errors": feed_errors,
    }