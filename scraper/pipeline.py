"""Pipeline entrypoint: ingest -> prune -> cluster -> persist.

Exit codes: 0 ok, 1 error, 3 another run already in progress.
The last stdout line is 'RESULT_JSON:{...}' (parsed by the Node API); logs go to stderr.
"""
import argparse
import json
import logging
import sys
import time

import config
import db
import ingest
from cluster import cluster_articles

log = logging.getLogger("pipeline")

EXIT_OK, EXIT_ERROR, EXIT_BUSY = 0, 1, 3


def load_window(conn) -> list:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, summary, body, source, published_at
            FROM articles
            WHERE published_at >= NOW() - make_interval(hours => %s)
            ORDER BY published_at
            """,
            (config.CLUSTER_WINDOW_HOURS,),
        )
        return [
            {"id": r[0], "title": r[1], "summary": r[2], "body": r[3], "source": r[4], "published_at": r[5]}
            for r in cur.fetchall()
        ]


def prune_old(conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM articles WHERE published_at < NOW() - make_interval(days => %s)",
            (config.RETENTION_DAYS,),
        )
        count = cur.rowcount
    conn.commit()
    return count


def cluster_totals(conn) -> tuple:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM clusters")
        clusters = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM articles WHERE cluster_id IS NOT NULL")
        clustered = cur.fetchone()[0]
    return clusters, clustered


def persist_clusters(conn, clusters: list) -> None:
    """Replaces all clusters atomically so API readers never see a half-written state."""
    with conn.cursor() as cur:
        cur.execute("UPDATE articles SET cluster_id = NULL WHERE cluster_id IS NOT NULL")
        cur.execute("DELETE FROM clusters")
        for cluster in clusters:
            cur.execute("INSERT INTO clusters (label) VALUES (%s) RETURNING id", (cluster["label"],))
            cluster_id = cur.fetchone()[0]
            cur.execute(
                "UPDATE articles SET cluster_id = %s WHERE id = ANY(%s)",
                (cluster_id, cluster["article_ids"]),
            )
    conn.commit()


def run(force_recluster: bool = False) -> dict:
    started = time.monotonic()
    conn = db.connect()
    try:
        if not db.try_lock(conn):
            raise db.PipelineBusy("another pipeline run holds the lock")
        db.ensure_schema(conn)

        stats = ingest.ingest_all(conn)
        pruned = prune_old(conn)

        skipped = (
            not force_recluster
            and stats["inserted"] == 0
            and pruned == 0
            and cluster_totals(conn)[0] > 0
        )
        if skipped:
            log.info("No new articles; keeping existing clusters")
        else:
            articles = load_window(conn)
            clusters = cluster_articles(articles)
            persist_clusters(conn, clusters)
            by_id = {a["id"]: a for a in articles}
            for c in clusters[:15]:
                titles = " | ".join(by_id[i]["title"][:60] for i in c["article_ids"][:3])
                log.info("cluster [%d] %s :: %s", len(c["article_ids"]), c["label"], titles)

        total_clusters, clustered_articles = cluster_totals(conn)
        return {
            **stats,
            "pruned": pruned,
            "skipped_clustering": skipped,
            "clusters": total_clusters,
            "clustered_articles": clustered_articles,
            "duration_seconds": round(time.monotonic() - started, 1),
        }
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="News Pulse pipeline")
    parser.add_argument("--recluster", action="store_true", help="recluster even when no new articles arrived")
    args = parser.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    try:
        result = run(args.recluster)
    except db.PipelineBusy as exc:
        log.warning("Pipeline busy: %s", exc)
        return EXIT_BUSY
    except Exception:
        log.exception("Pipeline failed")
        return EXIT_ERROR
    print("RESULT_JSON:" + json.dumps(result), flush=True)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())