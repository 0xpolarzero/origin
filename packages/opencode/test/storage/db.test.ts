import { describe, expect, test } from "bun:test"
import path from "path"
import { Database } from "../../src/storage/db"

describe("Database.Path", () => {
  test("returns the origin database path", () => {
    const file = path.basename(Database.Path)
    expect(file).toBe("origin.db")
  })
})
