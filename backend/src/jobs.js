import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "./config.js";
import { query } from "./db.js";
import { HttpError } from "./http.js";

const RESULT_PREFIX = "RESULT_JSON:";
const TAIL_LIMIT = 64 * 1024;

let activeJobId = null;
let inflightTrigger = null;

const tail = (text) => (text.length > TAIL_LIMIT ? text.slice(-TAIL_LIMIT) : text);

export function serializeJob(row) {
  return {
    jobId: row.id,
    status: row.status,
    stats: row.stats,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function getJob(id) {
  const { rows } = await query("SELECT * FROM jobs WHERE id = $1", [id]);
  return rows[0] || null;
}

export async function failStaleJobs() {
  await query(
    `UPDATE jobs
        SET status = 'failed', error = 'Server restarted before the job finished', finished_at = NOW()
      WHERE status IN ('queued', 'running')`
  );
}

function parseResult(stdout) {
  const line = stdout
    .split("\n")
    .reverse()
    .find((l) => l.startsWith(RESULT_PREFIX));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(RESULT_PREFIX.length));
  } catch {
    return null;
  }
}

function lastLines(text, count = 4) {
  return text.trim().split("\n").slice(-count).join(" | ").slice(0, 500);
}

function runPipeline() {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(config.pythonBin, [config.pipelineScript], {
      cwd: path.dirname(config.pipelineScript),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.pipelineTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = tail(stdout + chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = tail(stderr + chunk.toString());
    });
    child.on("error", (err) => finish({ ok: false, error: `Failed to start pipeline: ${err.message}` }));
    child.on("close", (code) => {
      if (timedOut) {
        return finish({ ok: false, error: `Pipeline timed out after ${config.pipelineTimeoutMs} ms` });
      }
      if (code === 0) return finish({ ok: true, stats: parseResult(stdout) });
      const reason = code === 3 ? "another pipeline run is already in progress" : lastLines(stderr);
      return finish({ ok: false, error: `Pipeline exited with code ${code}: ${reason}` });
    });
  });
}

async function runJob(id) {
  try {
    await query("UPDATE jobs SET status = 'running', started_at = NOW() WHERE id = $1", [id]);
    const outcome = await runPipeline();
    if (outcome.ok) {
      await query(
        "UPDATE jobs SET status = 'completed', stats = $2, finished_at = NOW() WHERE id = $1",
        [id, outcome.stats ? JSON.stringify(outcome.stats) : null]
      );
    } else {
      await query(
        "UPDATE jobs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1",
        [id, outcome.error]
      );
    }
  } catch (err) {
    console.error(`Job ${id} bookkeeping failed:`, err.message);
    await query(
      "UPDATE jobs SET status = 'failed', error = $2, finished_at = NOW() WHERE id = $1",
      [id, `Internal error: ${err.message}`.slice(0, 500)]
    ).catch(() => {});
  } finally {
    if (activeJobId === id) activeJobId = null;
  }
}

async function doTrigger() {
  if (activeJobId) {
    const existing = await getJob(activeJobId);
    if (existing && (existing.status === "queued" || existing.status === "running")) {
      return { job: existing, alreadyRunning: true };
    }
    activeJobId = null;
  }

  const { rows: ageRows } = await query(
    "SELECT EXTRACT(EPOCH FROM (NOW() - MAX(finished_at)))::float AS age FROM jobs"
  );
  const age = ageRows[0].age;
  if (age !== null && age < config.ingestCooldownSeconds) {
    const retryAfter = Math.ceil(config.ingestCooldownSeconds - age);
    throw new HttpError(429, `Pipeline ran moments ago. Try again in ${retryAfter}s.`, {
      headers: { "Retry-After": String(retryAfter) },
    });
  }

  const id = randomUUID();
  const { rows } = await query("INSERT INTO jobs (id, status) VALUES ($1, 'queued') RETURNING *", [id]);
  activeJobId = id;
  setImmediate(() => {
    void runJob(id);
  });
  return { job: rows[0], alreadyRunning: false };
}

/** Concurrent callers share one in-flight trigger so only one job is ever created. */
export function triggerIngest() {
  if (!inflightTrigger) {
    inflightTrigger = doTrigger().finally(() => {
      inflightTrigger = null;
    });
  }
  return inflightTrigger;
}