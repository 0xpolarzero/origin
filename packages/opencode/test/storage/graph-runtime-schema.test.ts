import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  RunAttemptTable,
  RunEventTable,
  RunNodeTable,
  RunSnapshotTable,
  SessionLinkTable,
  WorkflowRevisionTable,
} from "../../src/runtime/runtime.sql"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await resetDatabase()
})

describe("graph runtime schema migration", () => {
  test("database compatibility includes all phase 15 graph runtime tables", () => {
    expect(() => Database.Client()).not.toThrow()

    Database.use((db) => {
      expect(db.select().from(WorkflowRevisionTable).all()).toEqual([])
      expect(db.select().from(RunSnapshotTable).all()).toEqual([])
      expect(db.select().from(RunNodeTable).all()).toEqual([])
      expect(db.select().from(RunAttemptTable).all()).toEqual([])
      expect(db.select().from(RunEventTable).all()).toEqual([])
      expect(db.select().from(SessionLinkTable).all()).toEqual([])
    })
  })
})
