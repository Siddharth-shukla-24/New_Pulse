# News Pulse — Topic-Clustered News Timeline

Pulls live articles from four public RSS feeds, groups related articles into topic clusters, and plots each cluster on a timeline (bar = window in which the topic was active).

**Sources used:** BBC News, NPR, The Guardian (World), Al Jazeera.

## Architecture

```
GitHub Actions cron ─┐
                     ▼
Next.js (Vercel) ──► Node/Express API (Render, Docker) ──► Postgres (Neon)
   timeline UI        REST + job runner                        ▲
                          │ spawn                              │
                          └──► Python pipeline ────────────────┘
                               feeds → normalize → extract → dedupe → TF-IDF cluster
```

| Component | Runs on | Why |
|---|---|---|
| `frontend/` | Vercel | Native Next.js hosting, free tier |
| `backend/` + `scraper/` | Render (one Docker service with Node + Python) | The API triggers the pipeline as a **subprocess**, so both runtimes must share a host |
| Database | Neon Postgres | Shared by Python (writer) and Node (reader); hosted free tier |
| Scheduled ingest | GitHub Actions (every 30 min) | Keeps data fresh even when nobody clicks "Refresh"; an advisory lock prevents overlap with on-demand runs |

## Topic grouping (TF-IDF, Option B)

1. Text per article = headline (×2) + RSS summary + first 800 chars of extracted body.
2. TF-IDF (unigrams + bigrams, English + news-boilerplate stop words, sublinear tf).
3. Cosine distance matrix → **average-linkage agglomerative clustering** with a distance threshold.
4. Clusters with < 2 articles are dropped (not shown on the timeline).
5. Label = top 3 non-overlapping TF-IDF terms of the cluster centroid.

**Why average linkage:** single linkage chains unrelated stories together through one shared name; average linkage keeps clusters coherent.

**Parameters** (env-tunable): `CLUSTER_DISTANCE_THRESHOLD=0.85` (members must average a cosine similarity of about 0.15 or more), `MIN_CLUSTER_SIZE=2`. I chose the threshold by running the clusterer on a small synthetic set of headlines, including distinct stories that share an entity (Trump tariffs vs Trump golf trip). At 0.78 related stories fragmented and fell below the minimum size. At 0.85–0.90 they were recovered with no cross-story merges. Lower values fragment topics and higher values risk mega-clusters. To re-tune on live data, run `python pipeline.py --recluster` and read the log lines `cluster [size] label :: titles`.

**Limitation:** purely lexical — it can't tell that "PM resigns" and "government collapses" are the same story if they share few words, and broad recurring words ("Trump", "Gaza") can pull distinct sub-stories together. Cluster IDs are also regenerated on every recluster.

## Pipeline behaviour

- **Normalization:** feedparser + custom date handling (`published_parsed`, then free-form date strings, else fetch time flagged `published_inferred`); `description` / `content:encoded` unified to `summary`/fallback body.
- **Full body:** `trafilatura` per new article page; failures fall back to the feed content and never crash the run.
- **Dedupe / re-runnable:** canonical URL (tracking params stripped, scheme/`www` ignored) → SHA-256 → `UNIQUE` + `ON CONFLICT DO NOTHING`. Bodies are fetched only for unseen articles, and items older than the retention window are skipped at ingest. Reclustering is skipped when nothing new arrived.
- **Retention:** articles older than 14 days are pruned; clustering uses a 7-day window.
- **Concurrency:** Postgres advisory lock; the API also collapses concurrent triggers into one job and applies a short cooldown (429).

## API

| Endpoint | Purpose |
|---|---|
| `GET /clusters?sources=&limit=` | Clusters: label, article count, time range |
| `GET /clusters/:id?sources=` | Cluster + articles, chronological |
| `GET /timeline?sources=` | `{start, end, articleCount, intensity, durationMinutes}` per cluster |
| `GET /sources` | Sources with article counts (for the filter) |
| `POST /ingest/trigger` | Starts pipeline subprocess → `202 {jobId}` |
| `GET /ingest/status/:jobId` | Job status (queued / running / completed / failed) + stats |
| `GET /health` | Liveness + DB check |

`sources` omitted = all; `sources=` (empty) = none. Errors are `{ "error": { "message": ... } }` with 400/404/429/500.

## Assumptions

- "Related" = lexical similarity of headline/summary/body opening (no cross-source story merging).
- Only clusters of ≥ 2 articles are shown.
- Timestamps are stored in UTC and rendered in the viewer's local timezone.

## Local setup

```bash
# 1) Database: create a free Neon project, copy the DIRECT (non-pooled) connection string.

# 2) Python
cd scraper && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # set DATABASE_URL
python pipeline.py              # first ingest + cluster

# 3) Backend
cd ../backend && cp .env.example .env    # set DATABASE_URL; PYTHON_BIN=../scraper/.venv/bin/python
npm install && npm run dev

# 4) Frontend
cd ../frontend && cp .env.example .env.local
npm install && npm run dev      # http://localhost:3000
```

## Deployment

- **Neon:** create project, copy direct connection string.
- **Render:** New → Blueprint from this repo (`render.yaml`). Set `DATABASE_URL` and `CORS_ORIGINS=https://<your-vercel-domain>`.
- **Vercel:** import repo, Root Directory `frontend`, env `NEXT_PUBLIC_API_URL=https://<render-service>.onrender.com`.
- **GitHub:** add repo secret `DATABASE_URL` (enables the 30-minute cron workflow).