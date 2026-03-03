import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { base64Decode } from "@opencode-ai/util/encode"
import { openPalette } from "../actions"
import { test, expect, settingsKey } from "../fixtures"

test("startup from root lands in default global workspace session context", async ({ page }) => {
  await page.goto("/")

  await expect(page).toHaveURL(/\/[^/]+\/session(?:\/[^/]+)?/)
  const slug = /\/([^/]+)\/session(?:\/|$)/.exec(page.url())?.[1] ?? ""
  const directory = base64Decode(slug)
  expect(/[\\/]Documents[\\/]origin$/.test(directory)).toBe(true)
})

test("startup auto-creates configured global workspace directory when missing", async ({ page }) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-e2e-global-"))
  const directory = path.join(base, "missing", "workspace")

  try {
    await fs.rm(directory, { recursive: true, force: true })
    await page.addInitScript(
      (input: { key: string; directory: string }) => {
        const raw = localStorage.getItem(input.key)
        const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        const general =
          parsed.general && typeof parsed.general === "object"
            ? (parsed.general as Record<string, unknown>)
            : ({} as Record<string, unknown>)
        localStorage.setItem(
          input.key,
          JSON.stringify({
            ...parsed,
            general: {
              ...general,
              globalWorkspaceDirectory: input.directory,
            },
          }),
        )
      },
      { key: settingsKey, directory },
    )

    await page.goto("/")

    await expect(page).toHaveURL(/\/[^/]+\/session(?:\/[^/]+)?/)
    const slug = /\/([^/]+)\/session(?:\/|$)/.exec(page.url())?.[1] ?? ""
    const resolved = await fs.realpath(directory).catch(() => directory)
    expect(base64Decode(slug)).toBe(resolved)

    const info = await fs.stat(directory)
    expect(info.isDirectory()).toBe(true)
  } finally {
    await fs.rm(base, { recursive: true, force: true }).catch(() => undefined)
  }
})

test("ensure-directory failure falls back to home", async ({ page }) => {
  await page.route("**/path/ensure", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        path: "/forbidden",
        code: "EACCES",
        message: "permission denied",
      }),
    })
  })

  await page.goto("/")

  await expect(page.getByRole("button", { name: "Open project" }).first()).toBeVisible()
  await expect(page).toHaveURL("/")

  const palette = await openPalette(page)
  await expect(palette.getByRole("textbox").first()).toBeVisible()
})
