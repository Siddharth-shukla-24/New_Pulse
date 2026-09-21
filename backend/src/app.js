import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { query } from "./db.js";
import { HttpError } from "./http.js";
import ingestRouter from "./routes/ingest.js";
import readRouter from "./routes/read.js";

const app = express();

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(
  cors({
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "10kb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "News Pulse API",
    endpoints: [
      "GET /health",
      "GET /clusters?sources=&limit=",
      "GET /clusters/:id?sources=",
      "GET /timeline?sources=",
      "GET /sources",
      "POST /ingest/trigger",
      "GET /ingest/status/:jobId",
    ],
  });
});

app.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.use("/", readRouter);
app.use("/ingest", ingestRouter);

app.use((req, res) => {
  res.status(404).json({ error: { message: `Route not found: ${req.method} ${req.path}` } });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) {
    if (err.headers) res.set(err.headers);
    return res.status(err.status).json({
      error: { message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
    return res.status(400).json({ error: { message: "Invalid request body" } });
  }
  console.error(err);
  return res.status(500).json({ error: { message: "Internal server error" } });
});

export default app;