import { eq, and } from "drizzle-orm"
import { Database } from "@/storage/db"
import { AccountTable } from "./account.sql"
import z from "zod"

export namespace Account {
  export const Account = z.object({
    email: z.string(),
    url: z.string(),
  })
  export type Account = z.infer<typeof Account>

  function fromRow(row: (typeof AccountTable)["$inferSelect"]): Account {
    return {
      email: row.email,
      url: row.url,
    }
  }

  export function account(): Account | undefined {
    const row = Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.active, true)).get())
    return row ? fromRow(row) : undefined
  }

  export async function token(): Promise<string | undefined> {
    const row = Database.use((db) => db.select().from(AccountTable).where(eq(AccountTable.active, true)).get())
    if (!row) return undefined
    if (row.token_expiry && row.token_expiry > Date.now()) return row.access_token

    const res = await fetch(`${row.url}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: row.refresh_token,
      }).toString(),
    })

    if (!res.ok) return

    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }

    Database.use((db) =>
      db
        .update(AccountTable)
        .set({
          access_token: json.access_token,
          refresh_token: json.refresh_token ?? row.refresh_token,
          token_expiry: json.expires_in ? Date.now() + json.expires_in * 1000 : undefined,
        })
        .where(and(eq(AccountTable.email, row.email), eq(AccountTable.url, row.url)))
        .run(),
    )

    return json.access_token
  }

  export type Login = {
    code: string
    user: string
    url: string
    server: string
    expiry: number
    interval: number
  }

  export async function login(url?: string): Promise<Login> {
    const server = url ?? "https://web-14275-d60e67f5-pyqs0590.onporter.run"
    const res = await fetch(`${server}/auth/device/code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "opencode-cli" }),
    })

    if (!res.ok) throw new Error(`Failed to initiate device flow: ${await res.text()}`)

    const json = (await res.json()) as {
      device_code: string
      user_code: string
      verification_uri_complete: string
      expires_in: number
      interval: number
    }

    const full = `${server}${json.verification_uri_complete}`

    return {
      code: json.device_code,
      user: json.user_code,
      url: full,
      server,
      expiry: json.expires_in,
      interval: json.interval,
    }
  }

  export async function poll(
    input: Login,
  ): Promise<
    | { type: "success"; email: string }
    | { type: "pending" }
    | { type: "slow" }
    | { type: "expired" }
    | { type: "denied" }
    | { type: "error"; msg: string }
  > {
    const res = await fetch(`${input.server}/auth/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: input.code,
        client_id: "opencode-cli",
      }),
    })

    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      email?: string
      error?: string
      error_description?: string
    }

    if (json.access_token) {
      let email = json.email
      if (!email) {
        const me = await fetch(`${input.server}/api/user`, {
          headers: { authorization: `Bearer ${json.access_token}` },
        })
        const user = (await me.json()) as { email?: string }
        if (!user.email) {
          return { type: "error", msg: "No email in response" }
        }
        email = user.email
      }

      const access = json.access_token
      const expiry = Date.now() + json.expires_in! * 1000
      const refresh = json.refresh_token ?? ""

      Database.use((db) => {
        db.update(AccountTable).set({ active: false }).run()
        db.insert(AccountTable)
          .values({
            email,
            url: input.url,
            access_token: access,
            refresh_token: refresh,
            token_expiry: expiry,
            active: true,
          })
          .onConflictDoUpdate({
            target: [AccountTable.email, AccountTable.url],
            set: {
              access_token: access,
              refresh_token: refresh,
              token_expiry: expiry,
              active: true,
            },
          })
          .run()
      })

      return { type: "success", email }
    }

    if (json.error === "authorization_pending") {
      return { type: "pending" }
    }

    if (json.error === "slow_down") {
      return { type: "slow" }
    }

    if (json.error === "expired_token") {
      return { type: "expired" }
    }

    if (json.error === "access_denied") {
      return { type: "denied" }
    }

    return { type: "error", msg: json.error || JSON.stringify(json) }
  }
}
