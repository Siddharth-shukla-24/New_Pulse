export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

export function formatDateTime(iso: string | number): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatTick(ts: number, stepMs: number, major: boolean): string {
  const d = new Date(ts);
  return stepMs >= DAY || major ? dayFmt.format(d) : timeFmt.format(d);
}

export function formatRange(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return "—";
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (Math.abs(b - a) < MINUTE) return formatDateTime(a);
  return `${formatDateTime(a)} → ${formatDateTime(b)}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return "single moment";
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`;
  return `${Math.round(hours / 24)} d`;
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / DAY)} d ago`;
}