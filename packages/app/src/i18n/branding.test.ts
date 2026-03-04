import { describe, expect, test } from "bun:test"
import { dict as en } from "./en"
import { dict as ar } from "./ar"
import { dict as br } from "./br"
import { dict as bs } from "./bs"
import { dict as da } from "./da"
import { dict as de } from "./de"
import { dict as es } from "./es"
import { dict as fr } from "./fr"
import { dict as ja } from "./ja"
import { dict as ko } from "./ko"
import { dict as no } from "./no"
import { dict as pl } from "./pl"
import { dict as ru } from "./ru"
import { dict as th } from "./th"
import { dict as tr } from "./tr"
import { dict as zh } from "./zh"
import { dict as zht } from "./zht"

const locales = [en, ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht]

const appBrandKeys = [
  "provider.connect.apiKey.description",
  "provider.connect.oauth.code.visit.suffix",
  "provider.connect.oauth.auto.visit.suffix",
  "dialog.server.description",
  "toast.update.description",
  "error.page.report.prefix",
  "error.chain.mcpFailed",
  "sidebar.gettingStarted.line1",
  "settings.desktop.wsl.description",
  "settings.general.row.language.description",
  "settings.general.row.appearance.description",
  "settings.general.row.theme.description",
  "settings.updates.row.startup.description",
  "settings.updates.toast.latest.description",
] as const

describe("i18n branding", () => {
  test("uses origin branding for app-facing strings", () => {
    for (const locale of locales) {
      expect(locale["app.name.desktop"]).toContain("origin")

      for (const key of appBrandKeys) {
        expect(locale[key]).toBeDefined()
        expect(locale[key]).not.toContain("OpenCode")
      }
    }
  })

  test("keeps allowlisted OpenCode references", () => {
    for (const locale of locales) {
      expect(locale["provider.connect.opencodeZen.line1"]).toContain("OpenCode Zen")
      expect(locale["provider.connect.opencodeZen.visit.link"]).toBe("opencode.ai/zen")
      expect(locale["dialog.provider.opencode.tagline"]).toBeDefined()
      expect(locale["dialog.provider.opencodeGo.tagline"]).toBeDefined()
    }
  })
})
