import { test, expect } from "../fixtures"
import { dirPath } from "../utils"

test("project route redirects to /session", async ({ page, directory, slug }) => {
  await page.goto(dirPath(directory))

  await expect(page).toHaveURL(new RegExp(`/${slug}/session`))
  await expect(page.getByText("Build anything")).toBeVisible()
})
