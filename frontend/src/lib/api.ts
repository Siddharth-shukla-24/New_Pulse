import type { ClusterDetail, Job, SourceInfo, TimelineResponse } from "@/lib/types";

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      "Cannot reach the API. The server may be waking up — try again in a few seconds.",
      0
    );
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error?.message ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/** null = all sources (no param); [] = none selected. */
function sourcesQuery(sources: string[] | null): string {
  return sources === null ? "" : `?sources=${encodeURIComponent(sources.join(","))}`;
}

export function getTimeline(sources: string[] | null): Promise<TimelineResponse> {
  return request<TimelineResponse>(`/timeline${sourcesQuery(sources)}`);
}

export async function getSources(): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>("/sources");
  return data.sources;
}

export function getCluster(id: number, sources: string[] | null): Promise<ClusterDetail> {
  return request<ClusterDetail>(`/clusters/${id}${sourcesQuery(sources)}`);
}

export function triggerIngest(): Promise<Job> {
  return request<Job>("/ingest/trigger", { method: "POST" });
}

export function getIngestStatus(jobId: string): Promise<Job> {
  return request<Job>(`/ingest/status/${encodeURIComponent(jobId)}`);
}