"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { DAY, HOUR, MINUTE, formatDateTime, formatDuration, formatTick } from "@/lib/format";
import type { TimelineItem } from "@/lib/types";

const MARGIN_X = 28;
const AXIS_HEIGHT = 36;
const LANE_HEIGHT = 50;
const LANE_GAP = 4;
const LABEL_BASELINE_Y = 16;
const BAR_TOP_OFFSET = 24;
const BAR_MAX_HEIGHT = 20;
const MIN_BAR_WIDTH = 10;
const BAR_TIME_GAP_PX = 6;
const LABEL_GAP_PX = 14;
const MAX_LABEL_WIDTH = 240;
const MIN_LABEL_WIDTH = 22;
const BADGE_GAP = 6;
const BADGE_PAD_X = 6;
const BADGE_HEIGHT = 15;
const MIN_CANVAS_WIDTH = 760;

const LABEL_FONT = "600 12px Inter, system-ui, sans-serif";
const BADGE_FONT = "700 10.5px ui-monospace, SFMono-Regular, Menlo, monospace";
const HUE_SAT = 52;
const HUE_LIGHT = 54;

const STEPS = [30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

// Lazily created, reused across layout passes — avoids allocating a canvas per render.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  return measureCtx;
}

function textWidth(text: string, font: string): number {
  const ctx = getMeasureCtx();
  if (!ctx || text === "") return text.length * 6.5; // SSR-safe rough fallback; never rendered (client-only)
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Truncates to the widest prefix (plus an ellipsis) that fits maxWidth, measured precisely. */
function truncateToWidth(text: string, maxWidth: number, font: string): string {
  if (maxWidth <= 0) return "";
  if (textWidth(text, font) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(`${text.slice(0, mid)}…`, font) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? "" : `${text.slice(0, lo)}…`;
}

interface Domain {
  start: number;
  end: number;
}

interface Bar {
  item: TimelineItem;
  x: number;
  w: number;
  lane: number;
  barHeight: number;
  hue: number;
  labelText: string;
  showBadge: boolean;
  badgeX: number;
  badgeWidth: number;
}

interface Tick {
  x: number;
  label: string;
  major: boolean;
}

interface Layout {
  bars: Bar[];
  ticks: Tick[];
  laneCount: number;
}

function buildTicks(d0: number, d1: number, scale: (t: number) => number): Tick[] {
  const span = d1 - d0;
  const step = STEPS.find((s) => span / s <= 10) ?? STEPS[STEPS.length - 1];
  const offset = new Date(d0).getTimezoneOffset() * MINUTE;
  const first = Math.ceil((d0 - offset) / step) * step + offset;
  const ticks: Tick[] = [];
  for (let t = first; t <= d1; t += step) {
    const d = new Date(t);
    const major = d.getHours() === 0 && d.getMinutes() === 0;
    ticks.push({ x: scale(t), label: formatTick(t, step, major), major });
  }
  return ticks;
}

/**
 * Bars are packed into lanes purely by TIME overlap (classic interval scheduling), so two
 * bars sharing a lane never overlap in x. A label is then clipped to the gap before the next
 * bar in its OWN lane (or the canvas edge) — since lanes are vertically separate, that gap is
 * the only thing a label could ever collide with, which is what keeps labels free of overlap
 * and clipping regardless of how dense the timeline is.
 */
function computeLayout(items: TimelineItem[], width: number, domain: Domain | null): Layout | null {
  if (items.length === 0) return null;

  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const item of items) {
    minStart = Math.min(minStart, Date.parse(item.start));
    maxEnd = Math.max(maxEnd, Date.parse(item.end));
  }

  let d0: number;
  let d1: number;
  if (domain) {
    d0 = domain.start;
    d1 = domain.end;
  } else {
    const span = Math.max(maxEnd - minStart, HOUR);
    const pad = Math.max(span * 0.03, 15 * MINUTE);
    d0 = minStart - pad;
    d1 = maxEnd + pad;
  }
  if (d1 - d0 < HOUR) d1 = d0 + HOUR;

  const rightEdge = width - MARGIN_X;
  const inner = rightEdge - MARGIN_X;
  const scale = (t: number) => MARGIN_X + ((Math.min(Math.max(t, d0), d1) - d0) / (d1 - d0)) * inner;

  const sorted = [...items].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || b.articleCount - a.articleCount
  );

  // Pass 1: pack into lanes by bar extent only (labels are not involved yet).
  const laneEndX: number[] = [];
  const placed = sorted.map((item) => {
    const rawX = scale(Date.parse(item.start));
    const rawEnd = scale(Date.parse(item.end));
    const w = Math.max(rawEnd - rawX, MIN_BAR_WIDTH);
    const x = Math.min(rawX, rightEdge - w);
    let lane = laneEndX.findIndex((end) => end + BAR_TIME_GAP_PX <= x);
    if (lane === -1) {
      lane = laneEndX.length;
      laneEndX.push(x + w);
    } else {
      laneEndX[lane] = x + w;
    }
    return { item, x, w, lane };
  });

  // Pass 2: within each lane, bound every label by the start of the next occupant in that lane.
  const byLane = new Map<number, typeof placed>();
  for (const p of placed) {
    const list = byLane.get(p.lane) ?? [];
    list.push(p);
    byLane.set(p.lane, list);
  }
  for (const list of byLane.values()) list.sort((a, b) => a.x - b.x);

  const bars: Bar[] = placed.map((p) => {
    const laneItems = byLane.get(p.lane)!;
    const next = laneItems[laneItems.indexOf(p) + 1];
    const boundary = next ? next.x - LABEL_GAP_PX : rightEdge;
    const available = Math.max(0, Math.min(MAX_LABEL_WIDTH, boundary - p.x));

    const countText = String(p.item.articleCount);
    const badgeWidth = Math.max(20, textWidth(countText, BADGE_FONT) + BADGE_PAD_X * 2);
    const showBadge = available >= badgeWidth;
    const labelBudget = showBadge ? available - badgeWidth - BADGE_GAP : available;

    const labelText =
      labelBudget >= MIN_LABEL_WIDTH ? truncateToWidth(p.item.label, labelBudget, LABEL_FONT) : "";
    const badgeX = labelText ? p.x + textWidth(labelText, LABEL_FONT) + BADGE_GAP : p.x;

    return {
      item: p.item,
      x: p.x,
      w: p.w,
      lane: p.lane,
      barHeight: Math.min(BAR_MAX_HEIGHT, 8 + p.item.intensity * 12),
      hue: (p.item.id * 47) % 360,
      labelText,
      showBadge,
      badgeX,
      badgeWidth,
    };
  });

  return { bars, ticks: buildTicks(d0, d1, scale), laneCount: laneEndX.length };
}

interface TimelineProps {
  items: TimelineItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  domain?: Domain | null;
}

export default function Timeline({ items, selectedId, onSelect, domain }: TimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(wrapRef);
  const width = Math.max(measured, MIN_CANVAS_WIDTH);
  const [hover, setHover] = useState<{ item: TimelineItem; x: number; y: number } | null>(null);
  const [scrollable, setScrollable] = useState(false);

  const layout = useMemo(() => computeLayout(items, width, domain ?? null), [items, width, domain]);
  const bodyHeight = layout ? layout.laneCount * LANE_HEIGHT + LANE_GAP * 2 : 0;

  useEffect(() => {
    setScrollable(measured > 0 && width > measured + 4);
  }, [measured, width]);

  return (
    <div className={`timeline-frame${scrollable ? " is-scrollable" : ""}`}>
      <div className="timeline-scroll" ref={wrapRef}>
        {!layout ? (
          <div className="empty">
            <p className="empty-title">No topics in this window</p>
            <p className="empty-body">
              Widen the time window, adjust the source filters, or refresh to pull the latest headlines.
            </p>
          </div>
        ) : (
          <>
            <div className="timeline-axis">
              <svg width={width} height={AXIS_HEIGHT} aria-hidden="true">
                {layout.ticks.map((tick, i) => (
                  <g key={i}>
                    <line
                      x1={tick.x}
                      x2={tick.x}
                      y1={AXIS_HEIGHT - 9}
                      y2={AXIS_HEIGHT}
                      stroke={tick.major ? "#3d4a63" : "#242e42"}
                      strokeWidth={tick.major ? 1.5 : 1}
                    />
                    <text
                      x={tick.x}
                      y={AXIS_HEIGHT - 15}
                      textAnchor="middle"
                      fontSize={11}
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fontWeight={tick.major ? 700 : 500}
                      fill={tick.major ? "#e7e9f0" : "#8891a4"}
                    >
                      {tick.label}
                    </text>
                  </g>
                ))}
                <line x1={0} x2={width} y1={AXIS_HEIGHT - 0.5} y2={AXIS_HEIGHT - 0.5} stroke="#232b3d" />
              </svg>
            </div>

            <svg width={width} height={bodyHeight} role="group" aria-label="Topic clusters plotted over time">
              {layout.ticks.map((tick, i) => (
                <line
                  key={i}
                  x1={tick.x}
                  x2={tick.x}
                  y1={0}
                  y2={bodyHeight}
                  stroke={tick.major ? "#1c2434" : "#161d2b"}
                  strokeDasharray={tick.major ? undefined : "2 5"}
                />
              ))}

              {Array.from({ length: Math.max(layout.laneCount - 1, 0) }, (_, lane) => {
                const y = LANE_GAP + (lane + 1) * LANE_HEIGHT;
                return <line key={`lane-${lane}`} x1={MARGIN_X} x2={width - MARGIN_X} y1={y} y2={y} stroke="#161d2b" />;
              })}

              {layout.bars.map((bar) => {
                const laneTop = LANE_GAP + bar.lane * LANE_HEIGHT;
                const barY = laneTop + BAR_TOP_OFFSET + (BAR_MAX_HEIGHT - bar.barHeight) / 2;
                const selected = bar.item.id === selectedId;
                const fill = `hsl(${bar.hue} ${HUE_SAT}% ${HUE_LIGHT}%)`;
                return (
                  <g
                    key={bar.item.id}
                    className="bar"
                    role="button"
                    tabIndex={0}
                    aria-label={`${bar.item.label}, ${bar.item.articleCount} articles`}
                    aria-pressed={selected}
                    onClick={() => onSelect(bar.item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(bar.item.id);
                      }
                    }}
                    onMouseMove={(e) => setHover({ item: bar.item, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {/* Native tooltip: makes the full label discoverable even when the drawn label is truncated or hidden for space. */}
                    <title>{`${bar.item.label}, ${bar.item.articleCount} article${bar.item.articleCount === 1 ? "" : "s"}`}</title>
                    <rect x={bar.x - 4} y={laneTop} width={bar.w + 8} height={LANE_HEIGHT} fill="transparent" />
                    <rect
                      className="bar-body"
                      x={bar.x}
                      y={barY}
                      width={bar.w}
                      height={bar.barHeight}
                      rx={Math.min(6, bar.barHeight / 2)}
                      fill={fill}
                      stroke={selected ? "#e3a63a" : "none"}
                      strokeWidth={selected ? 2.5 : 0}
                    />
                    {bar.labelText && (
                      <text
                        x={bar.x}
                        y={laneTop + LABEL_BASELINE_Y}
                        fontSize={12}
                        fontFamily="Inter, system-ui, sans-serif"
                        fontWeight={selected ? 700 : 600}
                        fill={selected ? "#e7e9f0" : "#c3c9d8"}
                      >
                        {bar.labelText}
                      </text>
                    )}
                    {bar.showBadge && (
                      <g>
                        <rect
                          x={bar.badgeX}
                          y={laneTop + LABEL_BASELINE_Y - BADGE_HEIGHT + 3}
                          width={bar.badgeWidth}
                          height={BADGE_HEIGHT}
                          rx={BADGE_HEIGHT / 2}
                          fill="#1a2130"
                          stroke="#232b3d"
                        />
                        <text
                          x={bar.badgeX + bar.badgeWidth / 2}
                          y={laneTop + LABEL_BASELINE_Y}
                          textAnchor="middle"
                          fontSize={10.5}
                          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          fontWeight={700}
                          fill="#9aa3b8"
                        >
                          {bar.item.articleCount}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </>
        )}
      </div>

      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280),
            top: hover.y + 14,
          }}
        >
          <strong>{hover.item.label}</strong>
          <div>
            {hover.item.articleCount} articles · {hover.item.sources.join(", ")}
          </div>
          <div className="muted">
            {formatDateTime(hover.item.start)} → {formatDateTime(hover.item.end)}
          </div>
          <div className="muted">Active for {formatDuration(hover.item.durationMinutes)}</div>
        </div>
      )}
    </div>
  );
}