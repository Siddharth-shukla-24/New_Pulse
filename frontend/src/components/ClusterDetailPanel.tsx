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
        <div className="empty">Click a topic on the timeline to see its articles.</div>
      )}

      {hasSelection && error && <div className="banner" style={{ margin: 16 }}>{error}</div>}

      {hasSelection && !detail && !error && loading && (
        <>
          <div className="skeleton" style={{ width: "70%" }} />
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "85%" }} />
          <div className="skeleton" />
        </>
      )}

      {detail && (
        <div className="detail-body">
          <h3 className="detail-title">{detail.label}</h3>
          <div className="muted">
            {detail.articleCount} article{detail.articleCount === 1 ? "" : "s"} ·{" "}
            {formatRange(detail.startTime, detail.endTime)}
          </div>
          <div className="pills">
            {detail.sources.map((s) => (
              <span key={s} className="pill">
                {s}
              </span>
            ))}
          </div>

          {detail.articles.length === 0 ? (
            <div className="muted">No articles from the selected sources.</div>
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