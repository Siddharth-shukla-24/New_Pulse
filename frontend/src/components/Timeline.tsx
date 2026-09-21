"use client";

import { useMemo, useRef, useState } from "react";
import { useElementWidth } from "@/hooks/useElementWidth";
import { DAY, HOUR, MINUTE, formatDateTime, formatDuration, formatTick } from "@/lib/format";
import type { TimelineItem } from "@/lib/types";

const MARGIN_X = 24;
const AXIS_HEIGHT = 34;
const LANE_HEIGHT = 40;
const BODY_PAD = 10;
const MIN_BAR_WIDTH = 16;
const CHAR_PX = 6.6;
const LABEL_MAX_PX = 230;
const LABEL_GAP = 8;
const MIN_CANVAS_WIDTH = 880;

const STEPS = [30 * MINUTE, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY];

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
  labelX: number;
  labelAnchor: "start" | "end";
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

  const inner = width - MARGIN_X * 2;
  const scale = (t: number) => MARGIN_X + ((Math.min(Math.max(t, d0), d1) - d0) / (d1 - d0)) * inner;
  const maxLabelChars = Math.floor((LABEL_MAX_PX - 8) / CHAR_PX);

  const sorted = [...items].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start) || b.articleCount - a.articleCount
  );

  const laneEnds: number[] = [];
  const bars: Bar[] = sorted.map((item) => {
    const w = Math.max(scale(Date.parse(item.end)) - scale(Date.parse(item.start)), MIN_BAR_WIDTH);
    const x = Math.min(scale(Date.parse(item.start)), width - MARGIN_X - w);

    let text = `${item.label} · ${item.articleCount}`;
    if (text.length > maxLabelChars) text = `${text.slice(0, maxLabelChars - 1)}…`;
    const labelPx = text.length * CHAR_PX + 8;

    let labelAnchor: "start" | "end" = "start";
    let labelX = x + w + LABEL_GAP;
    let occStart = x;
    let occEnd = x + w + LABEL_GAP + labelPx;
    if (occEnd > width - MARGIN_X && x - LABEL_GAP - labelPx >= 0) {
      labelAnchor = "end";
      labelX = x - LABEL_GAP;
      occStart = x - LABEL_GAP - labelPx;
      occEnd = x + w;
    }

    let lane = laneEnds.findIndex((end) => end + 8 <= occStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(occEnd);
    } else {
      laneEnds[lane] = occEnd;
    }

    return {
      item,
      x,
      w,
      lane,
      barHeight: 12 + item.intensity * 16,
      hue: (item.id * 47) % 360,
      labelText: text,
      labelX,
      labelAnchor,
    };
  });

  return { bars, ticks: buildTicks(d0, d1, scale), laneCount: laneEnds.length };
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

  const layout = useMemo(() => computeLayout(items, width, domain ?? null), [items, width, domain]);

  const bodyHeight = layout ? layout.laneCount * LANE_HEIGHT + BODY_PAD * 2 : 0;

  return (
    <div className="timeline-scroll" ref={wrapRef}>
      {!layout ? (
        <div className="empty">
          No topic clusters to show yet. Adjust the filters, or press “Refresh data” to run the pipeline.
        </div>
      ) : (
        <>
          <div className="timeline-axis">
            <svg className="timeline-svg" width={width} height={AXIS_HEIGHT} aria-hidden="true">
              {layout.ticks.map((tick, i) => (
                <g key={i}>
                  <line x1={tick.x} x2={tick.x} y1={AXIS_HEIGHT - 8} y2={AXIS_HEIGHT} stroke="#3a4863" />
                  <text
                    x={tick.x}
                    y={AXIS_HEIGHT - 14}
                    textAnchor="middle"
                    fontSize={11}
                    fill={tick.major ? "#e8edf7" : "#8a97b1"}
                    fontWeight={tick.major ? 700 : 400}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <svg
            className="timeline-svg"
            width={width}
            height={bodyHeight}
            role="group"
            aria-label="Topic clusters plotted over time"
          >
            {layout.ticks.map((tick, i) => (
              <line
                key={i}
                x1={tick.x}
                x2={tick.x}
                y1={0}
                y2={bodyHeight}
                stroke={tick.major ? "#2c3a55" : "#1a2438"}
                strokeDasharray={tick.major ? undefined : "3 4"}
              />
            ))}

            {layout.bars.map((bar) => {
              const laneTop = BODY_PAD + bar.lane * LANE_HEIGHT;
              const y = laneTop + (LANE_HEIGHT - bar.barHeight) / 2;
              const selected = bar.item.id === selectedId;
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
                  <rect x={bar.x - 4} y={laneTop} width={bar.w + 8} height={LANE_HEIGHT} fill="transparent" />
                  <rect
                    className="bar-body"
                    x={bar.x}
                    y={y}
                    width={bar.w}
                    height={bar.barHeight}
                    rx={Math.min(8, bar.barHeight / 2)}
                    fill={`hsl(${bar.hue} 70% 58%)`}
                    opacity={0.55 + 0.45 * bar.item.intensity}
                    stroke={selected ? "#ffffff" : "none"}
                    strokeWidth={selected ? 2 : 0}
                  />
                  <text
                    x={bar.labelX}
                    y={laneTop + LANE_HEIGHT / 2 + 4}
                    textAnchor={bar.labelAnchor}
                    fontWeight={selected ? 700 : 500}
                  >
                    {bar.labelText}
                  </text>
                </g>
              );
            })}
          </svg>
        </>
      )}

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