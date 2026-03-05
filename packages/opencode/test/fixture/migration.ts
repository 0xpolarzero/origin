import { Database } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import path from "path"
import { readFileSync, readdirSync } from "fs"

function timestamp(name: string) {
  return Number(name.split("_")[0])
}

function entries() {
  const dir = path.join(import.meta.dirname, "../../migration")
  return readdirSync(dir, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => ({
      name: item.name,
      timestamp: timestamp(item.name),
      sql: readFileSync(path.join(dir, item.name, "migration.sql"), "utf-8"),
    }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

export function create_migrated_db(input?: { upto?: number }) {
  const sqlite = new Database(":memory:")
  sqlite.exec("PRAGMA foreign_keys = ON")
  const limit = input?.upto
  const list = typeof limit === "number" ? entries().filter((item) => item.timestamp <= limit) : entries()
  migrate(drizzle({ client: sqlite }), list)
  return {
    sqlite,
    db: drizzle({ client: sqlite }),
    migrations: list,
  }
}
