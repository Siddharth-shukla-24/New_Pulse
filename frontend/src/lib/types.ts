export interface TimelineItem {
  id: number;
  label: string;
  start: string;
  end: string;
  articleCount: number;
  intensity: number;
  durationMinutes: number;
  sources: string[];
}

export interface TimelineResponse {
  generatedAt: string;
  range: { start: string; end: string } | null;
  count: number;
  items: TimelineItem[];
}

export interface SourceInfo {
  name: string;
  articleCount: number;
}

export interface ArticleItem {
  id: number;
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  publishedInferred: boolean;
}

export interface ClusterDetail {
  id: number;
  label: string;
  articleCount: number;
  startTime: string | null;
  endTime: string | null;
  sources: string[];
  articles: ArticleItem[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Job {
  jobId: string;
  status: JobStatus;
  stats: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  alreadyRunning?: boolean;
}