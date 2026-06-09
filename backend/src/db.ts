import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { DB } from "./schema";

const databaseConnectionTimeoutMs = 1_000;
const databaseQueryTimeoutMs = 2_000;
const databaseHealthTimeoutMs = 2_500;

export function createDb(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionTimeoutMillis: databaseConnectionTimeoutMs,
        connectionString: databaseUrl,
        max: 5,
        query_timeout: databaseQueryTimeoutMs,
        statement_timeout: databaseQueryTimeoutMs
      })
    })
  });
}

export async function checkDatabase(db: Kysely<DB>): Promise<{ ok: true; latencyMs: number }> {
  const startedAt = performance.now();
  await withTimeout(sql`select 1`.execute(db), databaseHealthTimeoutMs, "database health check timed out");
  return { ok: true, latencyMs: Math.round(performance.now() - startedAt) };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}
