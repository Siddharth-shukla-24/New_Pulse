"""Normalizes heterogeneous RSS/Atom entries into one internal article schema."""
import calendar
import hashlib
import html
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from bs4 import BeautifulSoup
from dateutil import parser as date_parser

import config

TRACKING_PARAMS = {
    "at_medium", "at_campaign", "at_custom1", "at_custom2", "at_custom3", "at_custom4",
    "ocid", "cmpid", "xtor", "ns_source", "ns_mchannel", "ns_campaign", "ns_linkname",
    "ns_fee", "guccounter", "cmp", "fbclid", "gclid", "mc_cid", "mc_eid",
}


def clean_text(value: Optional[str]) -> str:
    """Strips HTML/entities, NUL bytes and collapses whitespace."""
    if not value:
        return ""
    if "<" in value:
        value = BeautifulSoup(value, "html.parser").get_text(" ")
    else:
        value = html.unescape(value)
    value = value.replace("\x00", "")
    return re.sub(r"\s+", " ", value).strip()


def normalize_url(url: str) -> str:
    """Canonical article URL: http(s) only, no fragment, no tracking params, no trailing slash."""
    parts = urlsplit((url or "").strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return ""
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not (k.lower().startswith("utm_") or k.lower() in TRACKING_PARAMS)
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme, parts.netloc.lower(), path, urlencode(query), ""))


def url_hash(normalized_url: str) -> str:
    """Scheme- and www-insensitive hash so http/https variants dedupe to one row."""
    key = re.sub(r"^https?://(www\.)?", "", normalized_url)
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def parse_entry_date(entry: Any) -> Optional[datetime]:
    """Tries feedparser's parsed struct first, then raw date strings in any format."""
    for key in ("published_parsed", "updated_parsed", "created_parsed"):
        parsed = entry.get(key)
        if parsed:
            try:
                return datetime.fromtimestamp(calendar.timegm(parsed), tz=timezone.utc)
            except (OverflowError, ValueError, TypeError, OSError):
                continue
    for key in ("published", "updated", "created", "dc_date"):
        raw = entry.get(key)
        if raw:
            try:
                dt = date_parser.parse(raw)
            except (ValueError, OverflowError, TypeError):
                continue
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
    return None


def normalize_entry(entry: Any, source: str, fetched_at: datetime) -> Optional[dict]:
    """Returns the internal schema dict, or None when the entry is unusable."""
    title = clean_text(entry.get("title"))
    url = normalize_url(entry.get("link") or "")
    if not title or not url:
        return None

    summary = clean_text(entry.get("summary") or entry.get("description"))

    # <content:encoded> / Atom <content>: keep the longest block as a fallback body.
    feed_body = ""
    for block in entry.get("content") or []:
        text = clean_text(block.get("value"))
        if len(text) > len(feed_body):
            feed_body = text
    if not summary:
        summary = feed_body
    summary = summary[: config.SUMMARY_MAX_CHARS]
    if feed_body == summary:
        feed_body = ""

    published = parse_entry_date(entry)
    inferred = False
    if published is None or published > fetched_at + timedelta(minutes=10):
        published, inferred = fetched_at, True

    return {
        "source": source,
        "title": title,
        "url": url,
        "url_hash": url_hash(url),
        "summary": summary,
        "feed_body": feed_body,
        "published_at": published,
        "published_inferred": inferred,
    }