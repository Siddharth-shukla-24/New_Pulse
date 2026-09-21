export class HttpError extends Error {
  constructor(status, message, { details, headers } = {}) {
    super(message);
    this.status = status;
    this.details = details;
    this.headers = headers;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function parseId(value) {
  if (!/^\d{1,9}$/.test(String(value))) {
    throw new HttpError(400, "id must be a positive integer");
  }
  const id = Number.parseInt(value, 10);
  if (id < 1) throw new HttpError(400, "id must be a positive integer");
  return id;
}

export function parseLimit(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new HttpError(400, "limit must be a positive integer");
  const limit = Number.parseInt(value, 10);
  if (limit < 1 || limit > max) throw new HttpError(400, `limit must be between 1 and ${max}`);
  return limit;
}

/**
 * ?sources=BBC News,NPR  -> ["BBC News", "NPR"]
 * ?sources=              -> []   (explicitly no sources)
 * (param absent)         -> null (all sources)
 */
export function parseSources(value) {
  if (value === undefined) return null;
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (typeof raw !== "string") throw new HttpError(400, "sources must be a comma-separated string");
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > 20 || list.some((s) => s.length > 100)) {
    throw new HttpError(400, "too many sources or a source name is too long");
  }
  return list;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;