"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ClusterDetailPanel from "@/components/ClusterDetailPanel";
import SourceFilter from "@/components/SourceFilter";
import Timeline from "@/components/Timeline";
import { useIngest } from "@/hooks/useIngest";
import { ApiError, getCluster, getSources, getTimeline } from "@/lib/api";
import { HOUR, MINUTE, formatDateTime, timeAgo } from "@/lib/format";
import type { ClusterDetail, SourceInfo, TimelineResponse } from "@/lib/types";

const RANGES: { label: string; hours: number | null }[] = [
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
  { label: "All", hours: null },
];
const AUTO_REFRESH_MS = 60_000;

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong");

export default function HomePage() {
  const [allSources, setAllSources] = useState<SourceInfo[]>([]);
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ClusterDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [rangeHours, setRangeHours] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const knownSources = useRef<Set<string>>(new Set());

  const ready = enabled !== null;

  /** null = no filtering (all sources on); otherwise the explicit list. */
  const filter = useMemo<string[] | null>(() => {
    if (enabled === null) return null;
    return allSources.every((s) => enabled.includes(s.name)) ? null : enabled;
  }, [enabled, allSources]);

  const loadSources = useCallback(async () => {
    const list = await getSources();
    setAllSources(list);
    const fresh = list.map((s) => s.name).filter((name) => !knownSources.current.has(name));
    fresh.forEach((name) => knownSources.current.add(name));
    setEnabled((prev) => (prev === null ? list.map((s) => s.name) : [...prev, ...fresh]));
  }, []);

  const loadTimeline = useCallback(
    async (silent: boolean) => {
      if (!silent) setLoading(true);
      try {
        setTimeline(await getTimeline(filter));
        setError(null);
      } catch (err) {
        if (!silent) setError(errorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [filter]
  );

  const { state: ingest, start: startRefresh } = useIngest(async () => {
    await loadSources();
    await loadTimeline(true);
  });

  useEffect(() => {
    loadSources().catch((err) => {
      setError(errorMessage(err));
      setLoading(false);
    });
  }, [loadSources]);

  useEffect(() => {
    if (ready) void loadTimeline(false);
  }, [ready, loadTimeline]);

  useEffect(() => {
    if (!autoRefresh || !ready) return;
    const timer = setInterval(() => {
      void loadTimeline(true);
      void loadSources().catch(() => undefined);
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [autoRefresh, ready, loadTimeline, loadSources]);

  const generatedAt = timeline?.generatedAt;
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getCluster(selectedId, filter)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setDetailError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Cluster ids are regenerated on every recluster; a vanished id just deselects.
        if (err instanceof ApiError && err.status === 404) {
          setSelectedId(null);
          return;
        }
        setDetailError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, filter, generatedAt]);

  const visibleItems = useMemo(() => {
    if (!timeline) return [];
    if (rangeHours === null || !timeline.range) return timeline.items;
    const cutoff = Date.parse(timeline.range.end) - rangeHours * HOUR;
    return timeline.items.filter((item) => Date.parse(item.end) >= cutoff);
  }, [timeline, rangeHours]);

  const domain = useMemo(() => {
    if (rangeHours === null || !timeline?.range) return null;
    const end = Date.parse(timeline.range.end);
    return { start: end - rangeHours * HOUR, end: end + 15 * MINUTE };
  }, [timeline, rangeHours]);

  const totalArticles = useMemo(
    () => visibleItems.reduce((sum, item) => sum + item.articleCount, 0),
    [visibleItems]
  );

  const toggleSource = (name: string) =>
    setEnabled((prev) => {
      if (prev === null) return prev;
      return prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name];
    });

  const running = ingest.phase === "running";

  return (
    <main className="page">
      <header className="header">
        <div className="brand">
          <h1>News Pulse</h1>
          <p>Live headlines from multiple outlets, grouped into topics and plotted over time.</p>
        </div>
        <div className="header-actions">
          {ingest.message && (
            <span
              className={`status ${ingest.phase === "completed" ? "ok" : ingest.phase === "failed" ? "err" : ""}`}
              aria-live="polite"
            >
              {ingest.message}
            </span>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void startRefresh()} disabled={running}>
            {running && <span className="spinner" aria-hidden="true" />}
            {running ? "Refreshing…" : "Refresh data"}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="toolbar-row">
          <SourceFilter
            sources={allSources}
            enabled={enabled ?? []}
            onToggle={toggleSource}
            onAll={() => setEnabled(allSources.map((s) => s.name))}
          />
        </div>
        <div className="toolbar-row">
          <div className="toolbar-group">
            <span className="toolbar-label">Window</span>
            <div className="segmented" role="group" aria-label="Time window">
              {RANGES.map((range) => (
                <button
                  key={range.label}
                  type="button"
                  aria-pressed={rangeHours === range.hours}
                  onClick={() => setRangeHours(range.hours)}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            <span className="live-dot pulsing" aria-hidden="true" style={{ opacity: autoRefresh ? 1 : 0 }} />
            Auto-refresh (60s)
          </label>
        </div>
      </div>

      {error && <div className="banner">{error}</div>}

      <div className="layout">
        <section className="panel" aria-label="Timeline">
          <div className="panel-head">
            <h2>
              {visibleItems.length} topic{visibleItems.length === 1 ? "" : "s"} · {totalArticles} articles
            </h2>
            <span className="muted mono">
              {timeline ? `Updated ${timeAgo(timeline.generatedAt)}` : loading ? "Loading…" : ""}
              {timeline?.range ? ` · through ${formatDateTime(timeline.range.end)}` : ""}
            </span>
          </div>
          {loading && !timeline ? (
            <div style={{ padding: "16px 0" }}>
              <div className="skeleton" style={{ width: "40%" }} />
              <div className="skeleton" style={{ width: "75%" }} />
              <div className="skeleton" style={{ width: "55%" }} />
              <div className="skeleton" style={{ width: "65%" }} />
            </div>
          ) : (
            <Timeline items={visibleItems} selectedId={selectedId} onSelect={setSelectedId} domain={domain} />
          )}
          <div className="legend">
            Bar length marks how long a topic stayed active, height marks article volume, and the badge is the
            article count. Click a bar to open its articles.
          </div>
        </section>

        <ClusterDetailPanel
          hasSelection={selectedId !== null}
          detail={detail && detail.id === selectedId ? detail : null}
          loading={detailLoading}
          error={detailError}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </main>
  );
}