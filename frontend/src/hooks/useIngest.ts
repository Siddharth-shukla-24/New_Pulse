import { useCallback, useEffect, useRef, useState } from "react";
import { getIngestStatus, triggerIngest } from "@/lib/api";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_POLL_ERRORS = 3;

export interface IngestState {
  phase: "idle" | "running" | "completed" | "failed";
  message: string | null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function summarize(stats: Record<string, unknown> | null): string {
  if (!stats) return "Pipeline finished.";
  const inserted = Number(stats.inserted ?? 0);
  const clusters = Number(stats.clusters ?? 0);
  return `${inserted} new article${inserted === 1 ? "" : "s"} · ${clusters} topic${clusters === 1 ? "" : "s"}`;
}

export function useIngest(onCompleted: () => void | Promise<void>) {
  const [state, setState] = useState<IngestState>({ phase: "idle", message: null });
  const mounted = useRef(true);
  const busy = useRef(false);
  const callback = useRef(onCompleted);
  callback.current = onCompleted;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const update = (next: IngestState) => {
      if (mounted.current) setState(next);
    };

    try {
      update({ phase: "running", message: "Starting pipeline…" });
      let job = await triggerIngest();
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let pollErrors = 0;

      while (job.status === "queued" || job.status === "running") {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the pipeline to finish");
        update({
          phase: "running",
          message: job.status === "queued" ? "Queued…" : "Scraping feeds & grouping topics…",
        });
        await sleep(POLL_INTERVAL_MS);
        if (!mounted.current) return;
        try {
          job = await getIngestStatus(job.jobId);
          pollErrors = 0;
        } catch (err) {
          pollErrors += 1;
          if (pollErrors >= MAX_CONSECUTIVE_POLL_ERRORS) throw err;
        }
      }

      if (job.status === "failed") throw new Error(job.error ?? "Pipeline failed");
      await callback.current();
      update({ phase: "completed", message: summarize(job.stats) });
    } catch (err) {
      update({ phase: "failed", message: err instanceof Error ? err.message : "Refresh failed" });
    } finally {
      busy.current = false;
    }
  }, []);

  return { state, start };
}