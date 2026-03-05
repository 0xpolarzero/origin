import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { WorkflowKnowledge } from "../../src/workflow/knowledge"
import { tmpdir } from "../fixture/fixture"

async function write(root: string, file: string, content: string) {
  const target = path.join(root, file)
  await mkdir(path.dirname(target), { recursive: true })
  await Bun.write(target, content)
}

async function read(root: string, file: string) {
  return Bun.file(path.join(root, file)).text()
}

describe("knowledge-base collision policy", () => {
  test("AC-05: interactive replace overwrites existing file", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/note.md", "old")

    const result = await WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "new",
      mode: "interactive",
      action: "replace",
    })

    expect(result.status).toBe("replaced")
    expect(result.collision).toBe(true)
    expect(result.resolved_path).toBe("note.md")
    expect(await read(dir.path, ".origin/knowledge-base/note.md")).toBe("new")
  })

  test("AC-05: interactive create_copy preserves original and writes deterministic copy", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/note.md", "old")

    const result = await WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "copy",
      mode: "interactive",
      action: "create_copy",
    })

    expect(result.status).toBe("created_copy")
    expect(result.collision).toBe(true)
    expect(result.resolved_path).toBe("note (copy).md")
    expect(await read(dir.path, ".origin/knowledge-base/note.md")).toBe("old")
    expect(await read(dir.path, ".origin/knowledge-base/note (copy).md")).toBe("copy")
  })

  test("AC-05: interactive cancel keeps file unchanged", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/note.md", "old")

    const result = await WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "ignored",
      mode: "interactive",
      action: "cancel",
    })

    expect(result.status).toBe("canceled")
    expect(result.collision).toBe(true)
    expect(result.resolved_path).toBeNull()
    expect(result.notification?.action).toBe("cancel")
    expect(await read(dir.path, ".origin/knowledge-base/note.md")).toBe("old")
  })

  test("AC-05: automated cron and signal force create_copy with notification metadata", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/note.md", "old")

    const cron = await WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "cron",
      mode: "cron",
      action: "replace",
    })

    const signal = await WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "signal",
      mode: "signal",
      action: "replace",
    })

    expect(cron.status).toBe("created_copy")
    expect(cron.notification?.mode).toBe("cron")
    expect(cron.notification?.action).toBe("create_copy")
    expect(cron.notification?.forced).toBe(true)

    expect(signal.status).toBe("created_copy")
    expect(signal.notification?.mode).toBe("signal")
    expect(signal.notification?.action).toBe("create_copy")
    expect(signal.notification?.forced).toBe(true)

    expect(await read(dir.path, ".origin/knowledge-base/note.md")).toBe("old")
    expect(await read(dir.path, ".origin/knowledge-base/note (copy).md")).toBe("cron")
    expect(await read(dir.path, ".origin/knowledge-base/note (copy 2).md")).toBe("signal")
  })

  test("concurrent automated imports produce unique deterministic copy paths", async () => {
    await using dir = await tmpdir({ git: true })
    await write(dir.path, ".origin/knowledge-base/note.md", "old")

    const first = WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "a",
      mode: "cron",
    })
    const second = WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "b",
      mode: "signal",
    })
    const third = WorkflowKnowledge.import_file({
      directory: dir.path,
      path: "note.md",
      content: "c",
      mode: "cron",
    })

    const result = await Promise.all([first, second, third])
    const paths = result.map((item) => item.resolved_path).filter((item): item is string => !!item).toSorted()
    expect(paths).toEqual(["note (copy 2).md", "note (copy 3).md", "note (copy).md"])
    expect(new Set(paths).size).toBe(3)

    expect(await read(dir.path, ".origin/knowledge-base/note.md")).toBe("old")
    expect(await Bun.file(path.join(dir.path, ".origin/knowledge-base/note (copy).md")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir.path, ".origin/knowledge-base/note (copy 2).md")).exists()).toBe(true)
    expect(await Bun.file(path.join(dir.path, ".origin/knowledge-base/note (copy 3).md")).exists()).toBe(true)
  })
})
