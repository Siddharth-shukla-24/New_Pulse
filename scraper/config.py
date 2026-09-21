"""Runtime configuration for the News Pulse pipeline (all overridable via env vars)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    return float(raw) if raw else default


DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

FEEDS = [
    {"source": "BBC News", "url": "http://feeds.bbci.co.uk/news/rss.xml"},
    {"source": "NPR", "url": "https://feeds.npr.org/1001/rss.xml"},
    {"source": "The Guardian", "url": "https://www.theguardian.com/world/rss"},
    {"source": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
]

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36 NewsPulse/1.0"
)

FEED_TIMEOUT = _int("FEED_TIMEOUT", 15)
ARTICLE_TIMEOUT = _int("ARTICLE_TIMEOUT", 12)
MAX_ENTRIES_PER_FEED = _int("MAX_ENTRIES_PER_FEED", 40)
MAX_NEW_ARTICLES = _int("MAX_NEW_ARTICLES", 150)
FETCH_WORKERS = _int("FETCH_WORKERS", 8)
MAX_BODY_CHARS = _int("MAX_BODY_CHARS", 20000)
SUMMARY_MAX_CHARS = 1000

RETENTION_DAYS = _int("RETENTION_DAYS", 14)
CLUSTER_WINDOW_HOURS = _int("CLUSTER_WINDOW_HOURS", 168)
CLUSTER_DISTANCE_THRESHOLD = _float("CLUSTER_DISTANCE_THRESHOLD", 0.78)
MIN_CLUSTER_SIZE = _int("MIN_CLUSTER_SIZE", 2)
BODY_CHARS_FOR_CLUSTERING = _int("BODY_CHARS_FOR_CLUSTERING", 800)