import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { base64Encode } from "@opencode-ai/util/encode"
import { createRoot } from "solid-js"
import { canDisposeDirectory, pickDirectoriesToEvict } from "./global-sync/eviction"
import { estimateRootSessionTotal, loadRootSessionsWithFallback } from "./global-sync/session-load"

type Session = {
  id: string
  directory: string
  title?: string
  parentID?: string | null
}

type Link = {
  role: "execution_node" | "run_followup"
  visibility: "hidden" | "visible"
}

type Note = {
  title: string
  description?: string
  href?: string
}

type Event = {
  name: string
  details: unknown
}

type Store = {
  project: {
    all: (directory: string) => Array<{ type: string; session?: string; run_id?: string }>
  }
}

let init: (() => Store) | undefined
let params = {} as { dir?: string; id?: string }
let list: Array<(event: Event) => void> = []
let notes: Note[] = []
let calls: Array<{ directory: string; session_id: string }> = []
let sessions = new Map<string, Session>()
let links = new Map<string, Link | null>()
let fails = new Set<string>()

const sdk = {
  event: {
    listen(fn: (event: Event) => void) {
      list.push(fn)
      return () => {
        list = list.filter((item) => item !== fn)
      }
    },
  },
  client: {
    session: {
      async get(input: { sessionID?: string }) {
        const session = input.sessionID ? sessions.get(input.sessionID) : undefined
        if (!session) throw new Error("missing session")
        return { data: session }
      },
    },
  },
}

const sync = {
  child() {
    return [{ session: [] }]
  },
}

const platform = {
  platform: "desktop" as const,
  openLink() {},
  async restart() {},
  back() {},
  forward() {},
  async notify(title: string, description?: string, href?: string) {
    notes.push({ title, description, href })
  },
}

const settings = {
  notifications: {
    agent: () => true,
    errors: () => true,
  },
  sounds: {
    agentEnabled: () => false,
    agent: () => "agent",
    errorsEnabled: () => false,
    errors: () => "error",
  },
}

const language = {
  t: (key: string) => key,
}

const server = {
  current: {
    http: {
      url: "http://origin.test",
      username: "origin",
      password: "secret",
    },
  },
}

beforeAll(async () => {
  mock.module("@solidjs/router", () => ({
    useParams: () => params,
  }))
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: (input: { init: () => Store }) => {
      init = input.init
      return {
        use: () => undefined,
        provider: () => undefined,
      }
    },
  }))
  mock.module("@/context/global-sdk", () => ({
    useGlobalSDK: () => sdk,
  }))
  mock.module("@/context/global-sync", () => ({
    useGlobalSync: () => sync,
    canDisposeDirectory,
    pickDirectoriesToEvict,
    estimateRootSessionTotal,
    loadRootSessionsWithFallback,
  }))
  mock.module("@/context/platform", () => ({
    usePlatform: () => platform,
  }))
  mock.module("@/context/language", () => ({
    useLanguage: () => language,
  }))
  mock.module("@/context/settings", () => ({
    useSettings: () => settings,
  }))
  mock.module("@/context/server", () => ({
    useServer: () => server,
  }))
  mock.module("@/utils/persist", () => ({
    Persist: {
      global: (key: string) => key,
    },
    persisted: (_key: string, input: unknown) => {
      if (!Array.isArray(input)) throw new Error("persisted test input must be a store tuple")
      return [input[0], input[1], null, () => true]
    },
  }))
  const mod = await import("./notification")
  mod.NotificationTesting.set({
    loadWorkflowSessionLink: async (input: { directory: string; session_id: string }) => {
      calls.push({ directory: input.directory, session_id: input.session_id })
      if (fails.has(input.session_id)) throw new Error("lookup failed")
      const link = links.get(input.session_id)
      if (!link) return null
      return {
        session_id: input.session_id,
        role: link.role,
        visibility: link.visibility,
        run_id: null,
        run_node_id: null,
        run_attempt_id: null,
        readonly: true,
      }
    },
  })
  mock.restore()
})

afterAll(async () => {
  const mod = await import("./notification")
  mod.NotificationTesting.set()
})

beforeEach(() => {
  params = {}
  list = []
  notes = []
  calls = []
  sessions = new Map()
  links = new Map()
  fails = new Set()
})

function mount() {
  const start = init
  if (!start) throw new Error("notification init missing")
  return createRoot((dispose) => ({
    dispose,
    store: start(),
  }))
}

function emit(name: string, details: unknown) {
  list.slice().forEach((fn) => fn({ name, details }))
}

async function wait(check: () => void) {
  for (let i = 0; i < 20; i++) {
    try {
      check()
      return
    } catch (error) {
      if (i === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

describe("notification context session-link integration", () => {
  test("suppresses hidden execution sessions on session.idle", async () => {
    sessions.set("sess_hidden", {
      id: "sess_hidden",
      directory: "/tmp/origin",
      title: "Hidden execution",
    })
    links.set("sess_hidden", {
      role: "execution_node",
      visibility: "hidden",
    })

    const root = mount()

    emit("/tmp/origin", {
      type: "session.idle",
      properties: {
        sessionID: "sess_hidden",
      },
    })

    await wait(() => {
      expect(calls).toEqual([{ directory: "/tmp/origin", session_id: "sess_hidden" }])
    })
    expect(root.store.project.all("/tmp/origin")).toEqual([])
    expect(notes).toEqual([])

    root.dispose()
  })

  test("fails closed on session.error when link lookup errors for a run workspace", async () => {
    sessions.set("sess_run", {
      id: "sess_run",
      directory: "/tmp/origin/.origin/runs/run_42",
      title: "Run execution",
    })
    fails.add("sess_run")

    const root = mount()

    emit("/tmp/origin", {
      type: "session.error",
      properties: {
        sessionID: "sess_run",
        error: "boom",
      },
    })

    await wait(() => {
      expect(calls).toEqual([{ directory: "/tmp/origin", session_id: "sess_run" }])
    })
    expect(root.store.project.all("/tmp/origin")).toEqual([])
    expect(notes).toEqual([])

    root.dispose()
  })

  test("keeps visible follow-up sessions notifyable with session hrefs", async () => {
    sessions.set("sess_followup", {
      id: "sess_followup",
      directory: "/tmp/origin",
      title: "Visible follow-up",
    })
    links.set("sess_followup", {
      role: "run_followup",
      visibility: "visible",
    })

    const root = mount()

    emit("/tmp/origin", {
      type: "session.idle",
      properties: {
        sessionID: "sess_followup",
      },
    })

    await wait(() => {
      expect(root.store.project.all("/tmp/origin")).toHaveLength(1)
      expect(notes).toEqual([
        {
          title: "notification.session.responseReady.title",
          description: "Visible follow-up",
          href: `/${base64Encode("/tmp/origin")}/session/sess_followup`,
        },
      ])
    })
    expect(root.store.project.all("/tmp/origin")).toEqual([
      expect.objectContaining({
        type: "turn-complete",
        session: "sess_followup",
      }),
    ])

    root.dispose()
  })

  test("maps workflow run outcomes into run-detail href notifications", async () => {
    const root = mount()

    emit("/tmp/origin", {
      type: "workflow.run.outcome",
      properties: {
        workspace_id: "wrk_1",
        workflow_id: "workflow.daily",
        run_id: "run_7",
        outcome: "failed",
        status: "failed",
        reason_code: "node_failed",
        failure_code: "agent_error",
      },
    })

    await wait(() => {
      expect(root.store.project.all("/tmp/origin")).toHaveLength(1)
      expect(notes).toEqual([
        {
          title: "Workflow run failed",
          description: "workflow.daily • failed",
          href: `/${base64Encode("/tmp/origin")}/runs/run_7`,
        },
      ])
    })
    expect(root.store.project.all("/tmp/origin")).toEqual([
      expect.objectContaining({
        type: "run-outcome",
        run_id: "run_7",
      }),
    ])

    root.dispose()
  })
})
