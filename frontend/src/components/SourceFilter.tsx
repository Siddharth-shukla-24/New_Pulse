"use client";

import type { SourceInfo } from "@/lib/types";

interface SourceFilterProps {
  sources: SourceInfo[];
  enabled: string[];
  onToggle: (name: string) => void;
  onAll: () => void;
}

export default function SourceFilter({ sources, enabled, onToggle, onAll }: SourceFilterProps) {
  const allOn = sources.length > 0 && sources.every((s) => enabled.includes(s.name));
  return (
    <div className="toolbar-group" role="group" aria-label="Filter by news source">
      <span className="toolbar-label">Sources</span>
      <button type="button" className="chip" aria-pressed={allOn} onClick={onAll}>
        All
      </button>
      {sources.map((source) => (
        <button
          key={source.name}
          type="button"
          className="chip"
          aria-pressed={enabled.includes(source.name)}
          onClick={() => onToggle(source.name)}
        >
          {source.name} <small>{source.articleCount}</small>
        </button>
      ))}
    </div>
  );
}