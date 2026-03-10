import { test, expect } from "../fixtures"
import { sessionIDFromUrl, withSession } from "../actions"
import { promptSelector } from "../selectors"

test("can send a prompt and receive a reply", async ({ page, sdk, gotoSession }) => {
  test.setTimeout(120_000)

  const pageErrors: string[] = []
  const onPageError = (err: Error) => {
    pageErrors.push(err.message)
  }
  page.on("pageerror", onPageError)

  const token = `E2E_OK_${Date.now()}`

  try {
    await withSession(sdk, `e2e prompt ${token}`, async (session) => {
      await gotoSession(session.id)

      const prompt = page.locator(promptSelector)
      await prompt.click()
      await page.keyboard.type(`Reply with exactly: ${token}`)
      await page.keyboard.press("Enter")

      await expect(page).toHaveURL(new RegExp(`/session/${session.id}(?:[/?#]|$)`), { timeout: 30_000 })

      const sessionID = (() => {
        const id = sessionIDFromUrl(page.url())
        if (!id) throw new Error(`Failed to parse session id from url: ${page.url()}`)
        return id
      })()

      await expect
        .poll(
          async () => {
            const messages = await sdk.session.messages({ sessionID, limit: 50 }).then((r) => r.data ?? [])
            return messages
              .filter((m) => m.info.role === "assistant")
              .flatMap((m) => m.parts)
              .filter((p) => p.type === "text")
              .map((p) => p.text)
              .join("\n")
          },
          { timeout: 90_000 },
        )
        .toContain(token)
    })
  } finally {
    page.off("pageerror", onPageError)
  }

  if (pageErrors.length > 0) {
    throw new Error(`Page error(s):\n${pageErrors.join("\n")}`)
  }
})
