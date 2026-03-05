import { afterEach, describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("runtime schema compatibility startup checks", () => {
  test("startup fails when required runtime trigger is missing", async () => {
    await resetDatabase()
    Database.use(() => 1)
    Database.close()

    const sqlite = new Sqlite(Database.Path)
    sqlite.exec("DROP TRIGGER run_ready_for_integration_at_immutable")
    sqlite.close()

    expect(() => Database.use(() => 1)).toThrow('schema compatibility check failed: missing trigger "run_ready_for_integration_at_immutable"')
  })
})
