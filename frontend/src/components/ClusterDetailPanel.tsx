"use client";

import { formatDateTime, formatRange, timeAgo } from "@/lib/format";
import type { ClusterDetail } from "@/lib/types";

interface ClusterDetailPanelProps {
  hasSelection: boolean;
  detail: ClusterDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}

export default function ClusterDetailPanel({
  hasSelection,
  detail,
  loading,
  error,
  onClose,
}: ClusterDetailPanelProps) {
  return (
    <aside className="panel detail" aria-live="polite">
      <div className="panel-head">
        <h2>Topic detail</h2>
        {hasSelection && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close detail panel">
            ✕
          </button>
        )}
      </div>

      {!hasSelection && (
        <div className="empty">
          <p className="empty-title">Nothing selected</p>
          <p className="empty-body">Click a topic on the timeline to see its articles here.</p>
        </div>
      )}

      {hasSelection && error && <div className="banner" style={{ margin: 16 }}>{error}</div>}

      {hasSelection && !detail && !error && loading && (
        <div style={{ padding: "4px 0 16px" }}>
          <div className="skeleton" style={{ width: "70%" }} />
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "85%" }} />
          <div className="skeleton" />
        </div>
      )}

      {detail && (
        <div className="detail-body">
          <h3 className="detail-title">{detail.label}</h3>
          <p className="muted detail-meta">
            {detail.articleCount} article{detail.articleCount === 1 ? "" : "s"} ·{" "}
            <span className="mono">{formatRange(detail.startTime, detail.endTime)}</span>
          </p>
          <div className="pills">
            {detail.sources.map((s) => (
              <span key={s} className="pill">
                {s}
              </span>
            ))}
          </div>

          {detail.articles.length === 0 ? (
            <p className="muted">No articles from the selected sources.</p>
          ) : (
            <ol className="articles">
              {detail.articles.map((article) => (
                <li key={article.id} className="article">
                  <a className="title" href={article.url} target="_blank" rel="noopener noreferrer">
                    {article.title}
                  </a>
                  <div className="meta">
                    <span className="pill">{article.source}</span>
                    <span
                      className="mono"
                      title={
                        article.publishedInferred
                          ? "The feed had no valid publish time; the fetch time is shown instead."
                          : undefined
                      }
                    >
                      {article.publishedInferred ? "≈ " : ""}
                      {formatDateTime(article.publishedAt)} · {timeAgo(article.publishedAt)}
                    </span>
                  </div>
                  {article.summary && <p>{article.summary}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </aside>
  );
}