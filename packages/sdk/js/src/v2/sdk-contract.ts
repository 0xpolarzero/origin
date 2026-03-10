import { OpencodeClient } from "./gen/sdk.gen.js"
import type { WorkflowStepView } from "./gen/types.gen.js"

const client = new OpencodeClient()

client.workflow.run.validate({ workflow_id: "workflow.daily" })
client.workflow.run.start({ workflow_id: "workflow.daily" })

// @ts-expect-error workflow_id must remain required
client.workflow.run.validate({})

// @ts-expect-error workflow_id must remain required
client.workflow.run.start({})

// @ts-expect-error run.validate requires a parameter object
client.workflow.run.validate()

// @ts-expect-error run.start requires a parameter object
client.workflow.run.start()

declare const step: WorkflowStepView

if (step.kind === "condition") {
  step.then?.map((child) => child.id)
  step.else?.map((child) => child.id)
}
