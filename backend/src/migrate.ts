import { Migrator } from "kysely/migration";
import { loadConfig } from "./config";
import { createDb } from "./db";
import { log } from "./logger";
import { StaticMigrationProvider } from "./migrations";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const migrator = new Migrator({
  db,
  provider: new StaticMigrationProvider()
});

const result = await migrator.migrateToLatest();

for (const migration of result.results ?? []) {
  log(migration.status === "Success" ? "info" : "error", "migration result", {
    migrationName: migration.migrationName,
    status: migration.status
  });
}

if (result.error) {
  log("error", "migration failed", { error: String(result.error) });
  await db.destroy();
  process.exit(1);
}

await db.destroy();
