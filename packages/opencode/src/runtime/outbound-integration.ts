import { Database, eq } from "@/storage/db"
import { and } from "drizzle-orm"
import z from "zod"
import { outbound_auth_state } from "./contract"
import { OutboundIntegrationTable } from "./runtime.sql"

const put_input = z.object({
  id: z.string().min(1),
  workspace_id: z.string(),
  adapter_id: z.string().min(1),
  enabled: z.boolean().default(true),
  auth_state: outbound_auth_state.default("healthy"),
  allowed_targets: z.array(z.string()).default([]),
})

const patch_input = z.object({
  id: z.string().min(1),
  workspace_id: z.string(),
  enabled: z.boolean().optional(),
  auth_state: outbound_auth_state.optional(),
  allowed_targets: z.array(z.string()).optional(),
})

const get_input = z.object({
  id: z.string().min(1),
  workspace_id: z.string(),
})

export namespace RuntimeOutboundIntegration {
  export const PutInput = put_input
  export const PatchInput = patch_input
  export const GetInput = get_input

  export function put(input: z.input<typeof PutInput>) {
    const parsed = PutInput.parse(input)
    return Database.transaction((db) => {
      const now = Date.now()
      const current = db
        .select()
        .from(OutboundIntegrationTable)
        .where(and(eq(OutboundIntegrationTable.workspace_id, parsed.workspace_id), eq(OutboundIntegrationTable.id, parsed.id)))
        .get()

      if (!current) {
        const row = {
          id: parsed.id,
          workspace_id: parsed.workspace_id,
          adapter_id: parsed.adapter_id,
          enabled: parsed.enabled,
          auth_state: parsed.auth_state,
          allowed_targets: parsed.allowed_targets,
          created_at: now,
          updated_at: now,
        }
        db.insert(OutboundIntegrationTable).values(row).run()
        return row
      }

      const updated = db
        .update(OutboundIntegrationTable)
        .set({
          workspace_id: parsed.workspace_id,
          adapter_id: parsed.adapter_id,
          enabled: parsed.enabled,
          auth_state: parsed.auth_state,
          allowed_targets: parsed.allowed_targets,
          updated_at: now,
        })
        .where(eq(OutboundIntegrationTable.id, parsed.id))
        .returning()
        .get()
      if (!updated) throw new Error(`Outbound integration not found: ${parsed.id}`)
      return updated
    })
  }

  export function patch(input: z.input<typeof PatchInput>) {
    const parsed = PatchInput.parse(input)
    return Database.transaction((db) => {
      const current = db
        .select()
        .from(OutboundIntegrationTable)
        .where(and(eq(OutboundIntegrationTable.workspace_id, parsed.workspace_id), eq(OutboundIntegrationTable.id, parsed.id)))
        .get()
      if (!current) return

      return db
        .update(OutboundIntegrationTable)
        .set({
          enabled: parsed.enabled === undefined ? current.enabled : parsed.enabled,
          auth_state: parsed.auth_state ?? current.auth_state,
          allowed_targets: parsed.allowed_targets ?? current.allowed_targets,
          updated_at: Date.now(),
        })
        .where(and(eq(OutboundIntegrationTable.workspace_id, parsed.workspace_id), eq(OutboundIntegrationTable.id, parsed.id)))
        .returning()
        .get()
    })
  }

  export function get(input: z.input<typeof GetInput>, tx?: Database.TxOrDb) {
    const parsed = GetInput.parse(input)
    if (tx) {
      return tx
        .select()
        .from(OutboundIntegrationTable)
        .where(and(eq(OutboundIntegrationTable.workspace_id, parsed.workspace_id), eq(OutboundIntegrationTable.id, parsed.id)))
        .get()
    }
    return Database.use((db) =>
      db
        .select()
        .from(OutboundIntegrationTable)
        .where(and(eq(OutboundIntegrationTable.workspace_id, parsed.workspace_id), eq(OutboundIntegrationTable.id, parsed.id)))
        .get(),
    )
  }
}
