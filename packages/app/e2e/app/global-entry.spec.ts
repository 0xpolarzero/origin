import fs from "node:fs/promises"
import { base64Decode } from "@opencode-ai/util/encode"
import {
  cleanupTestProject,
  createTestProject,
  openPalette,
  openProjectMenu,
  openSidebar,
  sessionIDFromUrl,
} from "../actions"
import { test, expect, settingsKey } from "../fixtures"
import { listItemKeySelector, projectCloseMenuSelector, projectSwitchSelector } from "../selectors"
import type { createSdk } from "../utils"

const entryKey = "entry:start-session"
type E2EPage = Parameters<typeof openPalette>[0]
type E2ESdk = ReturnType<typeof createSdk>

function directoryFromUrl(url: string) {
  const slug = /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
  return base64Decode(slug)
}

async function setGlobalWorkspace(page: E2EPage, directory: string) {
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
}

async function readFirstUserText(input: {
  sdk: E2ESdk
  directory: string
  sessionID: string
}) {
  const messages = await input.sdk.session.messages({ directory: input.directory, sessionID: input.sessionID, limit: 50 })
  const user = (messages.data ?? []).find((item) => item.info.role === "user")
  if (!user) return ""
  const text = user.parts.find(
    (part): part is (typeof user.parts)[number] & { type: "text"; text: string } =>
      part.type === "text" && typeof (part as { text?: unknown }).text === "string",
  )
  if (!text) return ""
  return text.text
}

async function invokeEntry(page: E2EPage, query: string, previousSessionID?: string) {
  const dialog = await openPalette(page)
  const input = dialog.getByRole("textbox").first()
  await input.fill(query)

  const entry = dialog.locator(listItemKeySelector(entryKey)).first()
  await expect(entry).toBeVisible()
  await expect(dialog.locator('[data-slot="list-item"]').first()).toHaveAttribute("data-key", entryKey)

  await page.keyboard.press("Enter")

  await expect
    .poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 })
    .not.toBe("")
  if (previousSessionID) {
    await expect
      .poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 })
      .not.toBe(previousSessionID)
  }

  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error("Missing session id after entry invocation")
  return {
    sessionID,
    directory: directoryFromUrl(page.url()),
  }
}

test("entry visibility is suppressed for empty and slash-prefixed queries, and ranks first when shown", async ({
  page,
  gotoSession,
}) => {
  await gotoSession()

  const dialog = await openPalette(page)
  const input = dialog.getByRole("textbox").first()

  await expect(dialog.locator(listItemKeySelector(entryKey))).toHaveCount(0)

  await input.fill("/open")
  await expect(dialog.locator(listItemKeySelector(entryKey))).toHaveCount(0)

  await input.fill("entry smoke")
  const entry = dialog.locator(listItemKeySelector(entryKey)).first()
  await expect(entry).toBeVisible()
  await expect(entry).toContainText("origin")
  await expect(dialog.locator('[data-slot="list-item"]').first()).toHaveAttribute("data-key", entryKey)
})

test("entry from non-default workspace creates fresh global sessions and sends typed text immediately", async ({
  page,
  sdk,
  withProject,
}) => {
  const globalDirectory = await createTestProject()
  const resolvedGlobalDirectory = await fs.realpath(globalDirectory).catch(() => globalDirectory)

  try {
    await setGlobalWorkspace(page, resolvedGlobalDirectory)

    await withProject(async ({ directory, slug, gotoSession }) => {
      await gotoSession()
      await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:/[^/]+)?$`))

      const firstQuery = `entry-first-${Date.now()}`
      const first = await invokeEntry(page, firstQuery)

      expect(first.directory).toBe(resolvedGlobalDirectory)
      expect(first.directory).not.toBe(directory)
      await expect
        .poll(() => readFirstUserText({ sdk, directory: resolvedGlobalDirectory, sessionID: first.sessionID }), {
          timeout: 30_000,
        })
        .toBe(firstQuery)

      const secondQuery = `entry-second-${Date.now()}`
      const second = await invokeEntry(page, secondQuery, first.sessionID)

      expect(second.directory).toBe(resolvedGlobalDirectory)
      expect(second.sessionID).not.toBe(first.sessionID)
      await expect
        .poll(() => readFirstUserText({ sdk, directory: resolvedGlobalDirectory, sessionID: second.sessionID }), {
          timeout: 30_000,
        })
        .toBe(secondQuery)
    })
  } finally {
    await cleanupTestProject(globalDirectory)
  }
})

test("protected global workspace cannot be removed from project actions", async ({ page }) => {
  const globalDirectory = await createTestProject()
  const resolvedGlobalDirectory = await fs.realpath(globalDirectory).catch(() => globalDirectory)

  try {
    await setGlobalWorkspace(page, resolvedGlobalDirectory)
    await page.goto("/")
    await expect
      .poll(async () => fs.realpath(directoryFromUrl(page.url())).catch(() => directoryFromUrl(page.url())))
      .toBe(resolvedGlobalDirectory)

    const slug = /\/([^/]+)\/session(?:\/|$)/.exec(page.url())?.[1]
    if (!slug) throw new Error("Missing protected project slug after global workspace bootstrap")

    await openSidebar(page)
    await expect(page.locator(projectSwitchSelector(slug)).first()).toBeVisible()

    await openProjectMenu(page, slug)
    const close = page.locator(projectCloseMenuSelector(slug)).first()
    await expect(close).toBeVisible()
    await expect
      .poll(async () => (await close.getAttribute("aria-disabled")) ?? (await close.getAttribute("data-disabled")))
      .toBeTruthy()

    await page.keyboard.press("Escape")
    await expect(page.locator(projectSwitchSelector(slug)).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:/[^/]+)?$`))
  } finally {
    await cleanupTestProject(globalDirectory)
  }
})

test("entry aborts with toast when agent/model selection is unavailable", async ({ page, sdk, withProject }) => {
  const globalDirectory = await createTestProject()
  const resolvedGlobalDirectory = await fs.realpath(globalDirectory).catch(() => globalDirectory)

  try {
    await setGlobalWorkspace(page, resolvedGlobalDirectory)
    await page.route("**/provider**", async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue()
        return
      }
      const url = new URL(route.request().url())
      if (!url.pathname.endsWith("/provider")) {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          all: [],
          connected: [],
          default: {},
        }),
      })
    })

    await withProject(async ({ slug }) => {
      const before = await sdk.session
        .list({ directory: resolvedGlobalDirectory })
        .then((result) => (result.data ?? []).length)

      const dialog = await openPalette(page)
      const input = dialog.getByRole("textbox").first()
      await input.fill(`entry-abort-${Date.now()}`)
      await expect(dialog.locator(listItemKeySelector(entryKey)).first()).toBeVisible()
      await page.keyboard.press("Enter")

      await expect(page.locator('[data-component="toast"]').last()).toContainText("Select an agent and model")
      await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:/[^/]+)?$`))

      await expect
        .poll(() => sdk.session.list({ directory: resolvedGlobalDirectory }).then((result) => (result.data ?? []).length))
        .toBe(before)
    })
  } finally {
    await cleanupTestProject(globalDirectory)
  }
})
