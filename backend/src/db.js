import fs from "node:fs/promises";
import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on("error", (err) => {
  console.error("Postgres pool error:", err.message);
});

export const query = (text, params) => pool.query(text, params);

export async function initSchema() {
  const sql = await fs.readFile(config.schemaPath, "utf8");
  await pool.query(sql);
}