import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"
import { closeDialog, openSettings } from "../actions"

test("models import is explicit and only applies visibility toggles", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        user: [{ providerID: "acme", modelID: "alpha", visibility: "hide" }],
        recent: [{ providerID: "noise", modelID: "recent" }],
        variant: { "noise/recent": "balanced" },
      }),
    )
  })

  await gotoSession()

  const before = await page.evaluate(() => {
    const raw = localStorage.getItem("origin.global.dat:model")
    return raw ? JSON.parse(raw) : null
  })
  expect(Array.isArray(before?.user) ? before.user : []).toEqual([])

  const settings = await openSettings(page)
  await settings.getByRole("tab", { name: "Models" }).click()
  const action = settings.getByRole("button", { name: "Load OpenCode model toggles" })
  await expect(action).toBeVisible()

  const beforeClick = await page.evaluate(() => localStorage.getItem("origin.global.dat:model"))
  expect(beforeClick).not.toBeNull()
  expect(beforeClick).toBe(localStorageSnapshot(before))

  await action.click()

  const toast = page.locator('[data-component="toast"]').last()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("1 model toggles imported from OpenCode.")

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem("origin.global.dat:model")
    return raw ? JSON.parse(raw) : null
  })
  expect(after?.recent).toEqual(before?.recent)
  expect(after?.variant).toEqual(before?.variant)
  expect(after?.user).toEqual(
    expect.arrayContaining([{ providerID: "acme", modelID: "alpha", visibility: "hide" }]),
  )

  await closeDialog(page, settings)
})

test("model import shows explicit feedback and no-op when OpenCode model source is missing", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("opencode.global.dat:model")
  })

  await gotoSession()

  const before = await page.evaluate(() => localStorage.getItem("origin.global.dat:model"))
  const settings = await openSettings(page)
  await settings.getByRole("tab", { name: "Models" }).click()

  await settings.getByRole("button", { name: "Load OpenCode model toggles" }).click()

  const toast = page.locator('[data-component="toast"]').last()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("OpenCode model toggles source was not found.")

  const after = await page.evaluate(() => localStorage.getItem("origin.global.dat:model"))
  expect(after).toBe(before)

  await closeDialog(page, settings)
})

test("model import shows explicit feedback and no-op when OpenCode model source is invalid", async ({ page, gotoSession }) => {
  await page.addInitScript(() => {
    localStorage.setItem("opencode.global.dat:model", "{bad")
  })

  await gotoSession()

  const before = await page.evaluate(() => localStorage.getItem("origin.global.dat:model"))
  const settings = await openSettings(page)
  await settings.getByRole("tab", { name: "Models" }).click()

  await settings.getByRole("button", { name: "Load OpenCode model toggles" }).click()

  const toast = page.locator('[data-component="toast"]').last()
  await expect(toast).toBeVisible()
  await expect(toast).toContainText("OpenCode model toggles source is invalid.")

  const after = await page.evaluate(() => localStorage.getItem("origin.global.dat:model"))
  expect(after).toBe(before)

  await closeDialog(page, settings)
})

test("hiding a model removes it from the model picker", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")

  const command = page.locator('[data-slash-id="model.choose"]')
  await expect(command).toBeVisible()
  await command.hover()
  await page.keyboard.press("Enter")

  const picker = page.getByRole("dialog")
  await expect(picker).toBeVisible()

  const target = picker.locator('[data-slot="list-item"]').first()
  await expect(target).toBeVisible()

  const key = await target.getAttribute("data-key")
  if (!key) throw new Error("Failed to resolve model key from list item")

  const name = (await target.locator("span").first().innerText()).trim()
  if (!name) throw new Error("Failed to resolve model name from list item")

  await page.keyboard.press("Escape")
  await expect(picker).toHaveCount(0)

  const settings = await openSettings(page)

  await settings.getByRole("tab", { name: "Models" }).click()
  const search = settings.getByPlaceholder("Search models")
  await expect(search).toBeVisible()
  await search.fill(name)

  const toggle = settings.locator('[data-component="switch"]').filter({ hasText: name }).first()
  const input = toggle.locator('[data-slot="switch-input"]')
  await expect(toggle).toBeVisible()
  await expect(input).toHaveAttribute("aria-checked", "true")
  await toggle.locator('[data-slot="switch-control"]').click()
  await expect(input).toHaveAttribute("aria-checked", "false")

  await closeDialog(page, settings)

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")
  await expect(command).toBeVisible()
  await command.hover()
  await page.keyboard.press("Enter")

  const pickerAgain = page.getByRole("dialog")
  await expect(pickerAgain).toBeVisible()
  await expect(pickerAgain.locator('[data-slot="list-item"]').first()).toBeVisible()

  await expect(pickerAgain.locator(`[data-slot="list-item"][data-key="${key}"]`)).toHaveCount(0)

  await page.keyboard.press("Escape")
  await expect(pickerAgain).toHaveCount(0)
})

function localStorageSnapshot(value: unknown) {
  return value ? JSON.stringify(value) : null
}

test("showing a hidden model restores it to the model picker", async ({ page, gotoSession }) => {
  await gotoSession()

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")

  const command = page.locator('[data-slash-id="model.choose"]')
  await expect(command).toBeVisible()
  await command.hover()
  await page.keyboard.press("Enter")

  const picker = page.getByRole("dialog")
  await expect(picker).toBeVisible()

  const target = picker.locator('[data-slot="list-item"]').first()
  await expect(target).toBeVisible()

  const key = await target.getAttribute("data-key")
  if (!key) throw new Error("Failed to resolve model key from list item")

  const name = (await target.locator("span").first().innerText()).trim()
  if (!name) throw new Error("Failed to resolve model name from list item")

  await page.keyboard.press("Escape")
  await expect(picker).toHaveCount(0)

  const settings = await openSettings(page)

  await settings.getByRole("tab", { name: "Models" }).click()
  const search = settings.getByPlaceholder("Search models")
  await expect(search).toBeVisible()
  await search.fill(name)

  const toggle = settings.locator('[data-component="switch"]').filter({ hasText: name }).first()
  const input = toggle.locator('[data-slot="switch-input"]')
  await expect(toggle).toBeVisible()
  await expect(input).toHaveAttribute("aria-checked", "true")

  await toggle.locator('[data-slot="switch-control"]').click()
  await expect(input).toHaveAttribute("aria-checked", "false")

  await toggle.locator('[data-slot="switch-control"]').click()
  await expect(input).toHaveAttribute("aria-checked", "true")

  await closeDialog(page, settings)

  await page.locator(promptSelector).click()
  await page.keyboard.type("/model")
  await expect(command).toBeVisible()
  await command.hover()
  await page.keyboard.press("Enter")

  const pickerAgain = page.getByRole("dialog")
  await expect(pickerAgain).toBeVisible()

  await expect(pickerAgain.locator(`[data-slot="list-item"][data-key="${key}"]`)).toBeVisible()

  await page.keyboard.press("Escape")
  await expect(pickerAgain).toHaveCount(0)
})
