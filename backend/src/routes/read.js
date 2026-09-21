import { Router } from "express";
import { query } from "../db.js";
import { HttpError, asyncHandler, parseId, parseLimit, parseSources } from "../http.js";

const router = Router();

const CLUSTER_SUMMARY_SQL = `
  SELECT c.id,
         c.label,
         COUNT(a.id)::int AS article_count,
         MIN(a.published_at) AS start_time,
         MAX(a.published_at) AS end_time,
         ARRAY_AGG(DISTINCT a.source ORDER BY a.source) AS sources
    FROM clusters c
    JOIN articles a ON a.cluster_id = c.id
   WHERE ($1::text[] IS NULL OR a.source = ANY($1::text[]))
   GROUP BY c.id, c.label
   ORDER BY MAX(a.published_at) DESC, c.id DESC
   LIMIT $2`;

const toClusterSummary = (row) => ({
  id: row.id,
  label: row.label,
  articleCount: row.article_count,
  startTime: row.start_time,
  endTime: row.end_time,
  sources: row.sources,
});

router.get(
  "/clusters",
  asyncHandler(async (req, res) => {
    const sources = parseSources(req.query.sources);
    const limit = parseLimit(req.query.limit, 100, 500);
    const { rows } = await query(CLUSTER_SUMMARY_SQL, [sources, limit]);
    res.json({ count: rows.length, clusters: rows.map(toClusterSummary) });
  })
);

router.get(
  "/clusters/:id",
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    const sources = parseSources(req.query.sources);

    const clusterResult = await query("SELECT id, label FROM clusters WHERE id = $1", [id]);
    if (clusterResult.rowCount === 0) throw new HttpError(404, `Cluster ${id} not found`);

    const { rows } = await query(
      `SELECT id,
              title,
              source,
              url,
              LEFT(summary, 400) AS summary,
              published_at AS "publishedAt",
              published_inferred AS "publishedInferred"
         FROM articles
        WHERE cluster_id = $1
          AND ($2::text[] IS NULL OR source = ANY($2::text[]))
        ORDER BY published_at ASC, id ASC`,
      [id, sources]
    );

    res.json({
      id,
      label: clusterResult.rows[0].label,
      articleCount: rows.length,
      startTime: rows.length ? rows[0].publishedAt : null,
      endTime: rows.length ? rows[rows.length - 1].publishedAt : null,
      sources: [...new Set(rows.map((r) => r.source))].sort(),
      articles: rows,
    });
  })
);

router.get(
  "/timeline",
  asyncHandler(async (req, res) => {
    const sources = parseSources(req.query.sources);
    const { rows } = await query(CLUSTER_SUMMARY_SQL, [sources, 500]);

    const maxCount = rows.reduce((max, r) => Math.max(max, r.article_count), 1);
    const items = rows.map((r) => ({
      id: r.id,
      label: r.label,
      start: r.start_time,
      end: r.end_time,
      articleCount: r.article_count,
      intensity: Number((r.article_count / maxCount).toFixed(3)),
      durationMinutes: Math.round((new Date(r.end_time) - new Date(r.start_time)) / 60000),
      sources: r.sources,
    }));

    let range = null;
    if (rows.length) {
      const starts = rows.map((r) => new Date(r.start_time).getTime());
      const ends = rows.map((r) => new Date(r.end_time).getTime());
      range = {
        start: new Date(Math.min(...starts)).toISOString(),
        end: new Date(Math.max(...ends)).toISOString(),
      };
    }

    res.json({ generatedAt: new Date().toISOString(), range, count: items.length, items });
  })
);

router.get(
  "/sources",
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT source AS name, COUNT(*)::int AS "articleCount"
         FROM articles
        GROUP BY source
        ORDER BY source`
    );
    res.json({ sources: rows });
  })
);

export default router;