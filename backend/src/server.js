import app from "./app.js";
import { config } from "./config.js";
import { initSchema, pool } from "./db.js";
import { failStaleJobs } from "./jobs.js";

async function main() {
  await initSchema();
  await failStaleJobs();

  const server = app.listen(config.port, () => {
    console.log(`News Pulse API listening on :${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});