import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import * as schema from "./schema"
import { Flag } from "../flag/flag"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = path.join(Global.Path.data, "origin.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>
  type Journal = { sql: string; timestamp: number; name: string }[]

  const state = {
    sqlite: undefined as BunDatabase | undefined,
  }

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
          name,
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  function compatibility(sqlite: BunDatabase) {
    const required = [
      { type: "table", name: "run" },
      { type: "table", name: "workflow_revision" },
      { type: "table", name: "run_snapshot" },
      { type: "table", name: "run_node" },
      { type: "table", name: "run_attempt" },
      { type: "table", name: "run_event" },
      { type: "table", name: "session_link" },
      { type: "table", name: "operation" },
      { type: "table", name: "draft" },
      { type: "table", name: "outbound_integration" },
      { type: "table", name: "integration_attempt" },
      { type: "table", name: "dispatch_attempt" },
      { type: "table", name: "audit_event" },
      { type: "table", name: "workflow_trigger" },
      { type: "table", name: "workflow_signal_dedupe" },
      { type: "index", name: "dispatch_attempt_draft_uq" },
      { type: "index", name: "integration_attempt_run_id_id_uq" },
      { type: "index", name: "run_queue_idx" },
      { type: "index", name: "run_snapshot_run_uq" },
      { type: "index", name: "run_node_run_node_id_uq" },
      { type: "index", name: "run_attempt_node_index_uq" },
      { type: "index", name: "run_event_run_sequence_uq" },
      { type: "index", name: "session_link_visibility_idx" },
      { type: "index", name: "audit_event_dispatch_provenance_idx" },
      { type: "index", name: "audit_event_policy_lineage_idx" },
      { type: "index", name: "workflow_trigger_workspace_workflow_type_uq" },
      { type: "index", name: "workflow_signal_dedupe_trigger_key_uq" },
      { type: "trigger", name: "run_ready_for_integration_at_immutable" },
    ] as const

    for (const item of required) {
      const row = sqlite
        .query("SELECT name FROM sqlite_master WHERE type = ? AND name = ? LIMIT 1")
        .get(item.type, item.name)
      if (row) continue
      throw new Error(`schema compatibility check failed: missing ${item.type} "${item.name}"`)
    }
  }

  export const Client = lazy(() => {
    log.info("opening database", { path: Path })

    const sqlite = new BunDatabase(Path, { create: true })
    state.sqlite = sqlite

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    const db = drizzle({ client: sqlite, schema })

    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      if (Flag.OPENCODE_SKIP_MIGRATIONS) {
        for (const item of entries) {
          item.sql = "select 1;"
        }
      }
      migrate(db, entries)
    }

    compatibility(sqlite)

    return db
  })

  export function close() {
    const sqlite = state.sqlite
    if (!sqlite) return
    sqlite.close()
    state.sqlite = undefined
    Client.reset()
  }

  export type TxOrDb = SQLiteTransaction<"sync", void, any, any> | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = (Client().transaction as any)((tx: TxOrDb) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
