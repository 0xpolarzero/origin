import type { Migration, MigrationProvider } from "kysely/migration";
import * as foundation from "../migrations/2026-06-09-0001_foundation";

const migrations: Record<string, Migration> = {
  "2026-06-09-0001_foundation": foundation
};

export class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}
