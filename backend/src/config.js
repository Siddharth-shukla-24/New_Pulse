import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return value;
}

// A relative path (contains a slash) is resolved against the backend working directory;
// otherwise spawn() would resolve it against the pipeline's cwd (scraper/). Bare names use PATH.
const rawPython = process.env.PYTHON_BIN || "python3";
const pythonBin = /[\\/]/.test(rawPython) ? path.resolve(process.cwd(), rawPython) : rawPython;

export const config = {
  port: intFromEnv("PORT", 4000),
  databaseUrl: process.env.DATABASE_URL || "",
  databaseSsl: process.env.DATABASE_SSL === "true",
  corsOrigins: (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  pythonBin,
  pipelineScript:
    process.env.PIPELINE_SCRIPT || path.join(repoRoot, "scraper", "pipeline.py"),
  schemaPath: path.join(repoRoot, "db", "schema.sql"),
  pipelineTimeoutMs: intFromEnv("PIPELINE_TIMEOUT_MS", 240000),
  ingestCooldownSeconds: intFromEnv("INGEST_COOLDOWN_SECONDS", 20),
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in.");
}