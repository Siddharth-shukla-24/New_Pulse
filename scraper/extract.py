"""Full-article body extraction. Never raises: failures return an empty string."""
import logging

import requests
import trafilatura

import config

log = logging.getLogger("extract")
MAX_HTML_BYTES = 5 * 1024 * 1024


def fetch_article_body(url: str) -> str:
    try:
        resp = requests.get(
            url,
            timeout=config.ARTICLE_TIMEOUT,
            headers={"User-Agent": config.USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        )
        resp.raise_for_status()
        if "html" not in resp.headers.get("Content-Type", "").lower():
            return ""
        if len(resp.content) > MAX_HTML_BYTES:
            return ""
        text = trafilatura.extract(
            resp.content,
            include_comments=False,
            include_tables=False,
            favor_precision=True,
        )
        return (text or "").replace("\x00", "").strip()[: config.MAX_BODY_CHARS]
    except Exception as exc:  # any network/parse failure must not crash the run
        log.warning("Body extraction failed for %s: %s", url, str(exc)[:160])
        return ""