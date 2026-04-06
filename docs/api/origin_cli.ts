/**
 * Origin CLI Specification
 *
 * Documentation artifact only.
 *
 * This file is the API-first specification for the full Origin CLI surface as it
 * should eventually be implemented with `incur`.
 *
 * The intention is:
 * - anything Origin-specific should be expressible through this CLI
 * - the CLI is the primary agent-facing API surface
 * - the CLI should be discoverable, composable, and context-rich
 * - the CLI should help agents fetch relevant context on the fly, not only mutate state
 */

export type CommandKind = "query" | "mutation" | "workflow" | "meta";
export type OptionType =
  | "string"
  | "boolean"
  | "integer"
  | "number"
  | "id"
  | "path"
  | "date"
  | "datetime"
  | "duration"
  | "enum"
  | "string[]"
  | "id[]"
  | "json"
  | "markdown";

export interface CliOptionSpec {
  name: string;
  type: OptionType;
  description: string;
  required?: boolean;
  multiple?: boolean;
  enumValues?: readonly string[];
  defaultValue?: string | number | boolean;
}

export interface CliCommandSpec {
  command: string;
  kind: CommandKind;
  summary: string;
  sourceDocs: readonly string[];
  args?: readonly CliOptionSpec[];
  flags?: readonly CliOptionSpec[];
  returns: string;
  sideEffects?: readonly string[];
  emitsActivity?: readonly string[];
  notes?: readonly string[];
}

export interface CliNamespaceSpec {
  summary: string;
  sourceDocs: readonly string[];
  commands: readonly CliCommandSpec[];
}

export interface OriginCliSpec {
  rootCommand: "origin";
  implementationTarget: "incur";
  status: "draft";
  principles: readonly string[];
  outputModels: Record<string, string>;
  globalFlags: readonly CliOptionSpec[];
  namespaces: Record<string, CliNamespaceSpec>;
}

const formatFlag = {
  name: "format",
  type: "enum",
  enumValues: ["json", "table", "md", "text"] as const,
  description: "Preferred output format for the command result.",
  defaultValue: "json",
} satisfies CliOptionSpec;

const limitFlag = {
  name: "limit",
  type: "integer",
  description: "Maximum number of items to return.",
} satisfies CliOptionSpec;

const cursorFlag = {
  name: "cursor",
  type: "string",
  description: "Pagination cursor for continuing a prior list query.",
} satisfies CliOptionSpec;

const queryFlag = {
  name: "query",
  type: "string",
  description: "Free-text query string used for filtering or search.",
} satisfies CliOptionSpec;

const domainsFlag = {
  name: "domains",
  type: "string[]",
  description:
    "Subset of domains to target, such as note, task, calendar, email, github, telegram, chat, memory, or automation.",
} satisfies CliOptionSpec;

const sinceFlag = {
  name: "since",
  type: "datetime",
  description: "Lower time bound for time-based filtering.",
} satisfies CliOptionSpec;

const untilFlag = {
  name: "until",
  type: "datetime",
  description: "Upper time bound for time-based filtering.",
} satisfies CliOptionSpec;

const includeContextFlag = {
  name: "include-context",
  type: "boolean",
  description: "Include related context and linked objects in the result.",
  defaultValue: false,
} satisfies CliOptionSpec;

const includeActivityFlag = {
  name: "include-activity",
  type: "boolean",
  description: "Include recent related activity events in the result.",
  defaultValue: false,
} satisfies CliOptionSpec;

const entityRefArg = {
  name: "entity",
  type: "id",
  required: true,
  description: "Stable Origin entity reference or domain-scoped object id.",
} satisfies CliOptionSpec;

const pathArg = {
  name: "path",
  type: "path",
  required: true,
  description: "Filesystem path on the host where Origin is running.",
} satisfies CliOptionSpec;

const revisionArg = {
  name: "revision-id",
  type: "id",
  required: true,
  description: "Stable revision id from the object's preserved local-first history.",
} satisfies CliOptionSpec;

const conflictArg = {
  name: "conflict-id",
  type: "id",
  required: true,
  description: "Stable sync or merge conflict id.",
} satisfies CliOptionSpec;

const listFlags = [limitFlag, cursorFlag, includeContextFlag, includeActivityFlag, formatFlag] as const;
const searchFlags = [queryFlag, domainsFlag, limitFlag, includeContextFlag, formatFlag] as const;

export const originCliSpec = {
  rootCommand: "origin",
  implementationTarget: "incur",
  status: "draft",
  principles: [
    "The CLI is the full agent-facing Origin API, not an afterthought wrapper.",
    "Commands should make discovery easy: agents must be able to learn what Origin can do from the CLI itself.",
    "Commands should return relevant context on the fly, not only raw state.",
    "Managed Origin domains are canonical where the PRD says so; provider-canonical domains should expose selective caches and operational metadata only.",
    "Mutating commands should act directly by default and emit visible activity events.",
    "Read commands should support filtered, context-rich retrieval that works well with both exact filters and semantic search.",
    "The CLI should stay noun-verb structured and composable, with stable command families across domains.",
  ],
  outputModels: {
    "EntityResult<T>":
      "A single object payload with stable id, timestamps, relevant links, and optional contextual expansion.",
    "ListResult<T>":
      "A paginated list payload with items, total-known count when cheap, cursor, and optional summary block.",
    "ActionResult":
      "A mutation result containing success status, affected ids, emitted activity events, and any provider-side ids.",
    "ContextPack":
      "A cross-domain, retrieval-oriented payload containing ranked entities, summaries, and linked references relevant to a goal.",
    "ActivityStream":
      "A list of user-visible activity events with actor, status, timestamps, targets, and structured metadata.",
    "ValidationResult":
      "A setup or integration validation payload containing checks, pass/fail status, and actionable remediation items.",
  },
  globalFlags: [
    formatFlag,
    {
      name: "actor",
      type: "string",
      description: "Explicit actor identifier for the command invocation when the caller wants to override the default actor inference.",
    },
    {
      name: "timezone",
      type: "string",
      description: "IANA timezone used for interpreting date/time inputs and rendering time-sensitive output.",
    },
    {
      name: "id-only",
      type: "boolean",
      description: "Return only stable ids for matching entities.",
      defaultValue: false,
    },
    includeContextFlag,
    includeActivityFlag,
    {
      name: "no-cache",
      type: "boolean",
      description: "Prefer fresh provider fetches instead of selective local caches when the command supports it.",
      defaultValue: false,
    },
    {
      name: "explain",
      type: "boolean",
      description: "Include a compact explanation of why the command returned these results or took these actions.",
      defaultValue: false,
    },
  ],
  namespaces: {
    capability: {
      summary: "Self-describing command discovery and schema export.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "capability list",
          kind: "meta",
          summary: "List all command families and currently available capabilities, optionally filtered by domain.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [domainsFlag, formatFlag],
          returns: "ListResult<CapabilitySpec>",
        },
        {
          command: "capability get",
          kind: "meta",
          summary: "Return the detailed schema for one command or command family.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "command", type: "string", required: true, description: "Command path such as `task create` or namespace such as `email`." }],
          flags: [formatFlag],
          returns: "EntityResult<CapabilitySpec>",
        },
        {
          command: "capability examples",
          kind: "meta",
          summary: "Return example invocations for one command or namespace.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "command", type: "string", required: true, description: "Command path or namespace to fetch examples for." }],
          flags: [formatFlag],
          returns: "ListResult<CapabilityExample>",
        },
        {
          command: "capability schema",
          kind: "meta",
          summary: "Export the full CLI schema in machine-readable form for tooling or agents.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [
            {
              name: "schema-format",
              type: "enum",
              enumValues: ["json", "ts", "md"] as const,
              description: "Schema export format.",
              defaultValue: "json",
            },
          ],
          returns: "ActionResult",
        },
      ],
    },
    status: {
      summary: "High-level system, sync, and integration status.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "status show",
          kind: "query",
          summary: "Return a top-level summary of Origin health, setup state, sync status, and connected integrations.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [includeActivityFlag, formatFlag],
          returns: "EntityResult<OriginStatusSummary>",
        },
        {
          command: "status health",
          kind: "query",
          summary: "Run health checks across core subsystems and report failures or degradations.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "ValidationResult",
        },
        {
          command: "status blockers",
          kind: "query",
          summary: "Return actionable blockers such as broken integrations, sync conflicts, or failing automations.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "ListResult<Blocker>",
        },
        {
          command: "status paths",
          kind: "query",
          summary: "Return important local paths such as the state directory, vault, blobs, caches, and SQLite files.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "EntityResult<OriginPathSummary>",
        },
      ],
    },
    context: {
      summary: "High-signal, retrieval-oriented commands for fetching relevant context on the fly.",
      sourceDocs: [
        "/Users/polarzero/code/projects/origin/docs/prd.md",
        "/Users/polarzero/code/projects/origin/docs/memory_protocol.md",
      ],
      commands: [
        {
          command: "context now",
          kind: "query",
          summary: "Return the current high-signal context snapshot across planning, inboxes, automations, and recent activity.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [domainsFlag, includeActivityFlag, formatFlag],
          returns: "ContextPack",
        },
        {
          command: "context relevant",
          kind: "query",
          summary: "Return the most relevant cross-domain context for a goal, question, or intended action.",
          sourceDocs: [
            "/Users/polarzero/code/projects/origin/docs/prd.md",
            "/Users/polarzero/code/projects/origin/docs/memory_protocol.md",
          ],
          args: [{ name: "goal", type: "string", required: true, description: "Plain-language task, question, or intended action." }],
          flags: [
            domainsFlag,
            {
              name: "mode",
              type: "enum",
              enumValues: ["exact", "semantic", "hybrid"] as const,
              description: "Retrieval mode. Hybrid is the default and preferred mode.",
              defaultValue: "hybrid",
            },
            limitFlag,
            formatFlag,
          ],
          returns: "ContextPack",
        },
        {
          command: "context entity",
          kind: "query",
          summary: "Return an enriched context pack centered on one entity and its linked state.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [entityRefArg],
          flags: [includeActivityFlag, formatFlag],
          returns: "ContextPack",
        },
        {
          command: "context day",
          kind: "query",
          summary: "Return a day-scoped context pack including agenda, due work, recent inbox pressure, and automation activity.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
          args: [{ name: "date", type: "date", required: true, description: "Date to inspect." }],
          flags: [domainsFlag, formatFlag],
          returns: "ContextPack",
        },
        {
          command: "context inbox",
          kind: "query",
          summary: "Return a consolidated inbox-oriented context pack across email, GitHub, Telegram, and notifications.",
          sourceDocs: [
            "/Users/polarzero/code/projects/origin/docs/api/email_api.md",
            "/Users/polarzero/code/projects/origin/docs/api/github_api.md",
            "/Users/polarzero/code/projects/origin/docs/api/telegram_api.md",
          ],
          flags: [domainsFlag, limitFlag, formatFlag],
          returns: "ContextPack",
        },
        {
          command: "context project",
          kind: "query",
          summary: "Return a cross-domain context pack for one project including linked tasks, notes, automations, and external items.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
          args: [{ name: "project-id", type: "id", required: true, description: "Project id." }],
          flags: [includeActivityFlag, formatFlag],
          returns: "ContextPack",
        },
      ],
    },
    search: {
      summary: "Cross-domain search and retrieval.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "search query",
          kind: "query",
          summary: "Run a general cross-domain search with exact filters and semantic expansion where helpful.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [
            queryFlag,
            domainsFlag,
            {
              name: "mode",
              type: "enum",
              enumValues: ["exact", "semantic", "hybrid"] as const,
              description: "Search strategy to use.",
              defaultValue: "hybrid",
            },
            limitFlag,
            formatFlag,
          ],
          returns: "ListResult<SearchResult>",
        },
        {
          command: "search similar",
          kind: "query",
          summary: "Find semantically similar items to an entity or a block of text.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [
            {
              name: "seed",
              type: "string",
              required: true,
              description: "Entity id or free text used as the similarity seed.",
            },
          ],
          flags: [domainsFlag, limitFlag, formatFlag],
          returns: "ListResult<SearchResult>",
        },
        {
          command: "search related",
          kind: "query",
          summary: "Return search hits related to a given entity, combining exact links and semantic neighbors.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [entityRefArg],
          flags: [domainsFlag, limitFlag, formatFlag],
          returns: "ListResult<SearchResult>",
        },
        {
          command: "search recent",
          kind: "query",
          summary: "Return recently touched entities across domains with optional filtering.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [domainsFlag, sinceFlag, untilFlag, limitFlag, formatFlag],
          returns: "ListResult<SearchResult>",
        },
        {
          command: "search resolve",
          kind: "query",
          summary: "Resolve a fuzzy name or handle into likely Origin entities or connected identities.",
          sourceDocs: [
            "/Users/polarzero/code/projects/origin/docs/prd.md",
            "/Users/polarzero/code/projects/origin/docs/onboarding.md",
          ],
          flags: [queryFlag, domainsFlag, formatFlag],
          returns: "ListResult<EntityResolution>",
        },
      ],
    },
    identity: {
      summary: "User and agent identity metadata that Origin keeps for recognition and setup.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
      commands: [
        {
          command: "identity user get",
          kind: "query",
          summary: "Return the owner's identity handles and recognition metadata.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [formatFlag],
          returns: "EntityResult<UserIdentity>",
        },
        {
          command: "identity user update",
          kind: "mutation",
          summary: "Update the owner's identity handles and recognition metadata.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [
            { name: "display-name", type: "string", description: "Owner display name." },
            { name: "emails", type: "string[]", description: "Primary owner email addresses." },
            { name: "github-username", type: "string", description: "Owner GitHub username." },
            { name: "telegram-handle", type: "string", description: "Owner Telegram handle." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["identity.user.updated"],
        },
        {
          command: "identity agent get",
          kind: "query",
          summary: "Return the connected agent identity summary across Google, GitHub, and Telegram.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [formatFlag],
          returns: "EntityResult<AgentIdentity>",
        },
        {
          command: "identity agent update",
          kind: "mutation",
          summary: "Update friendly labels and metadata for the connected agent identities.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [
            { name: "display-name", type: "string", description: "Friendly label for the agent identity." },
            { name: "description", type: "string", description: "Longer description or operator notes." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["identity.agent.updated"],
        },
        {
          command: "identity resolve",
          kind: "query",
          summary: "Resolve a user or agent handle into the known Origin identity record.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [queryFlag, formatFlag],
          returns: "ListResult<IdentityResolution>",
        },
      ],
    },
    integration: {
      summary: "High-level integration status and validation across provider domains.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "integration list",
          kind: "query",
          summary: "List all integrations, their connection status, and the last validation or sync status.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "ListResult<IntegrationStatus>",
        },
        {
          command: "integration get",
          kind: "query",
          summary: "Get the detailed status for one integration such as google, github, or telegram.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "integration", type: "string", required: true, description: "Integration key." }],
          flags: [formatFlag],
          returns: "EntityResult<IntegrationStatus>",
        },
        {
          command: "integration validate",
          kind: "workflow",
          summary: "Validate integration credentials, scopes, and provider reachability.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [domainsFlag, formatFlag],
          returns: "ValidationResult",
          emitsActivity: ["integration.validation.ran"],
        },
        {
          command: "integration refresh",
          kind: "workflow",
          summary: "Force a refresh of integration metadata or connection state without mutating provider data.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [domainsFlag, formatFlag],
          returns: "ActionResult",
          emitsActivity: ["integration.refreshed"],
        },
        {
          command: "integration connect oauth-start",
          kind: "workflow",
          summary: "Start an OAuth connection flow for a provider such as Google or GitHub.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "integration", type: "string", required: true, description: "Integration key such as `google` or `github`." }],
          flags: [
            { name: "redirect-uri", type: "string", description: "Optional explicit redirect URI." },
            { name: "scopes", type: "string[]", description: "Optional explicit scope override." },
            formatFlag,
          ],
          returns: "EntityResult<OAuthStart>",
          emitsActivity: ["integration.oauth.started"],
          notes: ["Returns provider auth context only. It should never surface stored secret material."],
        },
        {
          command: "integration connect oauth-complete",
          kind: "workflow",
          summary: "Complete an OAuth connection flow after the user authorizes the provider.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "integration", type: "string", required: true, description: "Integration key." }],
          flags: [
            { name: "code", type: "string", description: "Provider authorization code.", required: true },
            { name: "state", type: "string", description: "OAuth state token returned by the provider." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["integration.oauth.completed"],
        },
        {
          command: "integration disconnect",
          kind: "mutation",
          summary: "Disconnect an integration and revoke or invalidate its active Origin connection.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "integration", type: "string", required: true, description: "Integration key." }],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["integration.disconnected"],
        },
        {
          command: "integration scopes",
          kind: "query",
          summary: "Return configured scopes, granted scopes, and missing scopes for an integration.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "integration", type: "string", required: true, description: "Integration key." }],
          flags: [formatFlag],
          returns: "EntityResult<IntegrationScopeStatus>",
        },
      ],
    },
    setup: {
      summary: "Onboarding and setup orchestration commands.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
      commands: [
        {
          command: "setup status",
          kind: "query",
          summary: "Return the current onboarding phase status and any missing setup requirements.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [formatFlag],
          returns: "EntityResult<SetupStatus>",
        },
        {
          command: "setup phases",
          kind: "query",
          summary: "List setup phases, completion state, and next actions.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [formatFlag],
          returns: "ListResult<SetupPhaseStatus>",
        },
        {
          command: "setup validate",
          kind: "workflow",
          summary: "Run end-to-end setup validation across identity, integrations, vault, sync, and notifications.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [formatFlag],
          returns: "ValidationResult",
          emitsActivity: ["setup.validation.ran"],
        },
        {
          command: "setup mode set",
          kind: "mutation",
          summary: "Choose or update the deployment mode: local or vps.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [
            {
              name: "mode",
              type: "enum",
              required: true,
              enumValues: ["local", "vps"] as const,
              description: "Desired deployment mode.",
            },
          ],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["setup.mode.updated"],
        },
        {
          command: "setup continue",
          kind: "workflow",
          summary: "Advance onboarding by executing the next actionable setup step or a specified phase.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          flags: [{ name: "phase", type: "string", description: "Optional explicit phase key to continue." }, formatFlag],
          returns: "ActionResult",
          emitsActivity: ["setup.phase.continued"],
        },
        {
          command: "setup phase get",
          kind: "query",
          summary: "Return one onboarding phase with its required inputs, current state, and recovery guidance.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "phase", type: "string", required: true, description: "Onboarding phase key." }],
          flags: [formatFlag],
          returns: "EntityResult<SetupPhaseStatus>",
        },
        {
          command: "setup phase run",
          kind: "workflow",
          summary: "Run or resume one explicit onboarding phase instead of the next inferred phase.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"],
          args: [{ name: "phase", type: "string", required: true, description: "Onboarding phase key." }],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["setup.phase.ran"],
        },
      ],
    },
    chat: {
      summary: "Session-based conversations with the agent.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "chat list",
          kind: "query",
          summary: "List chat sessions with recent activity and summary metadata.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [...listFlags, { name: "archived", type: "boolean", description: "Include archived chats.", defaultValue: false }],
          returns: "ListResult<ChatSessionSummary>",
        },
        {
          command: "chat create",
          kind: "mutation",
          summary: "Create a new chat session.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [
            { name: "title", type: "string", description: "Optional session title." },
            { name: "seed-context", type: "id[]", description: "Optional entity refs to pre-attach to the session." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["chat.session.created"],
        },
        {
          command: "chat get",
          kind: "query",
          summary: "Return a chat session with its messages, linked context, and queue state.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "session-id", type: "id", required: true, description: "Chat session id." }],
          flags: [includeContextFlag, formatFlag],
          returns: "EntityResult<ChatSession>",
        },
        {
          command: "chat send",
          kind: "workflow",
          summary: "Send a message into a chat session, optionally attaching explicit entity context.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "session-id", type: "id", required: true, description: "Chat session id." }],
          flags: [
            { name: "message", type: "markdown", description: "Message body.", required: true },
            { name: "context", type: "id[]", description: "Explicit entity refs to attach to this message." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["chat.message.sent", "chat.response.received"],
        },
        {
          command: "chat rename",
          kind: "mutation",
          summary: "Rename a chat session.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "session-id", type: "id", required: true, description: "Chat session id." }],
          flags: [{ name: "title", type: "string", description: "New session title.", required: true }, formatFlag],
          returns: "ActionResult",
          emitsActivity: ["chat.session.renamed"],
        },
        {
          command: "chat archive",
          kind: "mutation",
          summary: "Archive a chat session without deleting it.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "session-id", type: "id", required: true, description: "Chat session id." }],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["chat.session.archived"],
        },
        {
          command: "chat delete",
          kind: "mutation",
          summary: "Delete a chat session from normal views.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          args: [{ name: "session-id", type: "id", required: true, description: "Chat session id." }],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["chat.session.deleted"],
        },
        {
          command: "chat outbox",
          kind: "query",
          summary: "List queued offline or retriable chat messages that have not been fully processed yet.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "ListResult<ChatOutboxItem>",
        },
      ],
    },
    memory: {
      summary: "Curated agent memory centered on Origin/Memory.md and linked supporting artifacts.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
      commands: [
        {
          command: "memory read",
          kind: "query",
          summary: "Read the curated memory index at Origin/Memory.md.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [includeContextFlag, formatFlag],
          returns: "EntityResult<MemoryFile>",
        },
        {
          command: "memory revise",
          kind: "mutation",
          summary: "Revise Origin/Memory.md with a markdown patch, append, or section replacement.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [
            {
              name: "mode",
              type: "enum",
              enumValues: ["append", "replace-section", "patch"] as const,
              description: "Revision mode.",
              required: true,
            },
            { name: "content", type: "markdown", description: "Markdown content or patch payload.", required: true },
            { name: "section", type: "string", description: "Section heading when using replace-section." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["memory.revised"],
        },
        {
          command: "memory add",
          kind: "mutation",
          summary: "Persist a durable memory item into Origin/Memory.md when it clearly matters later.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [
            { name: "content", type: "markdown", description: "Memory content to add.", required: true },
            { name: "reason", type: "string", description: "Why this belongs in durable memory." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["memory.entry.added"],
          notes: ["Use only for durable high-signal context. One-off output should stay in chat."],
        },
        {
          command: "memory artifact list",
          kind: "query",
          summary: "List supporting files or datasets that are referenced from Origin/Memory.md.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [formatFlag],
          returns: "ListResult<MemoryArtifact>",
        },
        {
          command: "memory artifact create",
          kind: "mutation",
          summary: "Create a supporting memory file or dataset for a recurrent topic and link it from memory.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [
            {
              name: "kind",
              type: "enum",
              enumValues: ["note", "folder", "json", "csv", "markdown-table"] as const,
              description: "Artifact kind to create.",
              required: true,
            },
            { name: "path", type: "path", description: "Desired artifact path under the workspace.", required: true },
            { name: "summary", type: "string", description: "Short memory-facing description of the artifact." },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["memory.artifact.created", "memory.revised"],
        },
        {
          command: "memory artifact link",
          kind: "mutation",
          summary: "Link an existing supporting artifact into Origin/Memory.md.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/memory_protocol.md"],
          flags: [
            { name: "path", type: "path", description: "Artifact path to link.", required: true },
            { name: "summary", type: "string", description: "Short memory-facing description.", required: true },
            formatFlag,
          ],
          returns: "ActionResult",
          emitsActivity: ["memory.artifact.linked", "memory.revised"],
        },
      ],
    },
    workspace: {
      summary: "Managed assistant workspace and vault-level operations.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        {
          command: "workspace status",
          kind: "query",
          summary: "Return vault/workspace status, indexing state, bridge health, and recent filesystem activity.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "EntityResult<WorkspaceStatus>",
        },
        {
          command: "workspace tree",
          kind: "query",
          summary: "List the current managed workspace tree.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [
            { name: "path", type: "path", description: "Optional path under the workspace root." },
            { name: "depth", type: "integer", description: "Maximum tree depth." },
            formatFlag,
          ],
          returns: "ListResult<WorkspaceEntry>",
        },
        {
          command: "workspace recent",
          kind: "query",
          summary: "List recently touched notes and files in the managed workspace.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [sinceFlag, untilFlag, limitFlag, formatFlag],
          returns: "ListResult<WorkspaceEntry>",
        },
        {
          command: "workspace search",
          kind: "query",
          summary: "Search within the managed workspace only.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [queryFlag, limitFlag, formatFlag],
          returns: "ListResult<WorkspaceEntry>",
        },
        {
          command: "workspace reindex",
          kind: "workflow",
          summary: "Force a reindex of the workspace, note bridge state, and derived retrieval indexes.",
          sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
          flags: [formatFlag],
          returns: "ActionResult",
          emitsActivity: ["workspace.reindexed"],
        },
      ],
    },
    note: {
      summary: "Managed note operations over the replicated markdown-backed note domain.",
      sourceDocs: [
        "/Users/polarzero/code/projects/origin/docs/prd.md",
        "/Users/polarzero/code/projects/origin/docs/memory_protocol.md",
      ],
      commands: [
        { command: "note list", kind: "query", summary: "List managed notes with optional folder, tag, and search filters.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [queryFlag, { name: "folder", type: "path", description: "Workspace folder filter." }, ...listFlags], returns: "ListResult<NoteSummary>" },
        { command: "note get", kind: "query", summary: "Return one note with markdown content and related metadata.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<Note>" },
        { command: "note create", kind: "mutation", summary: "Create a new managed note in the workspace.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [{ name: "path", type: "path", description: "Desired workspace path.", required: true }, { name: "title", type: "string", description: "Optional note title." }, { name: "content", type: "markdown", description: "Initial markdown content.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["note.created"] },
        { command: "note update", kind: "mutation", summary: "Update an existing note's markdown content or metadata.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [{ name: "content", type: "markdown", description: "Replacement or patch content." }, { name: "mode", type: "enum", enumValues: ["replace", "append", "patch"] as const, description: "Update mode.", defaultValue: "patch" }, formatFlag], returns: "ActionResult", emitsActivity: ["note.updated"] },
        { command: "note move", kind: "mutation", summary: "Move a note to another workspace path.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [{ name: "path", type: "path", description: "New workspace path.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["note.moved"] },
        { command: "note rename", kind: "mutation", summary: "Rename a note while preserving its location.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [{ name: "name", type: "string", description: "New file name.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["note.renamed"] },
        { command: "note delete", kind: "mutation", summary: "Delete a note from normal views.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["note.deleted"] },
        { command: "note search", kind: "query", summary: "Search note content and metadata within the managed workspace.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: searchFlags, returns: "ListResult<NoteSummary>" },
        { command: "note related", kind: "query", summary: "Return notes related to a given note or entity.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [limitFlag, formatFlag], returns: "ListResult<NoteSummary>" },
        { command: "note history", kind: "query", summary: "Return fine-grained note history derived from the replicated note model.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }], flags: [sinceFlag, untilFlag, formatFlag], returns: "ListResult<NoteHistoryEntry>" },
        { command: "note conflicts", kind: "query", summary: "Return unresolved or recent note conflicts for inspection.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [limitFlag, formatFlag], returns: "ListResult<NoteConflict>" },
        { command: "note restore", kind: "mutation", summary: "Restore a note to a prior preserved revision.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "note-id", type: "id", required: true, description: "Note id." }, revisionArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["note.restored"] },
        { command: "note conflict get", kind: "query", summary: "Get one note conflict with competing edits and import provenance.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [conflictArg], flags: [formatFlag], returns: "EntityResult<NoteConflict>" },
        { command: "note conflict resolve", kind: "mutation", summary: "Resolve a note conflict by choosing, merging, or replacing content explicitly.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [conflictArg], flags: [{ name: "strategy", type: "enum", enumValues: ["ours", "theirs", "merge", "replace"] as const, description: "Conflict-resolution strategy.", required: true }, { name: "content", type: "markdown", description: "Resolved markdown content when using `merge` or `replace`." }, formatFlag], returns: "ActionResult", emitsActivity: ["note.conflict.resolved"] },
      ],
    },
    file: {
      summary: "Arbitrary host filesystem operations on files accessible to Origin.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        { command: "file list", kind: "query", summary: "List files and folders under a host path.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "depth", type: "integer", description: "Maximum recursion depth." }, formatFlag], returns: "ListResult<FileEntry>" },
        { command: "file stat", kind: "query", summary: "Return metadata for a host file or folder.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [formatFlag], returns: "EntityResult<FileEntry>" },
        { command: "file read", kind: "query", summary: "Read a host file.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "encoding", type: "enum", enumValues: ["utf8", "base64", "binary"] as const, description: "Read encoding.", defaultValue: "utf8" }, formatFlag], returns: "EntityResult<FileReadResult>" },
        { command: "file write", kind: "mutation", summary: "Write a host file.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "content", type: "string", description: "File content.", required: true }, { name: "encoding", type: "enum", enumValues: ["utf8", "base64"] as const, description: "Write encoding.", defaultValue: "utf8" }, formatFlag], returns: "ActionResult", emitsActivity: ["file.written"] },
        { command: "file patch", kind: "mutation", summary: "Patch a host text file using a diff or targeted replacement.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "patch", type: "string", description: "Patch payload.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["file.patched"] },
        { command: "file mkdir", kind: "mutation", summary: "Create a directory on the host filesystem.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["file.directory.created"] },
        { command: "file move", kind: "mutation", summary: "Move or rename a host file or folder.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "to", type: "path", description: "Destination path.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["file.moved"] },
        { command: "file copy", kind: "mutation", summary: "Copy a host file or folder.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [{ name: "to", type: "path", description: "Destination path.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["file.copied"] },
        { command: "file delete", kind: "mutation", summary: "Delete a host file or folder.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["file.deleted"] },
        { command: "file search", kind: "query", summary: "Search file names or text content under a host path.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [pathArg], flags: [queryFlag, { name: "content", type: "boolean", description: "Search file contents instead of names only.", defaultValue: true }, limitFlag, formatFlag], returns: "ListResult<FileSearchResult>" },
      ],
    },
    planning: {
      summary: "High-signal planning read models spanning tasks, calendar items, projects, and labels.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
      commands: [
        { command: "planning today", kind: "query", summary: "Return the current day's planning view including tasks, due windows, and scheduled items.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "date", type: "date", description: "Optional explicit date override." }, formatFlag], returns: "EntityResult<PlanningDayView>" },
        { command: "planning week", kind: "query", summary: "Return the current week's planning view.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "week-start", type: "date", description: "Optional explicit week start date." }, formatFlag], returns: "EntityResult<PlanningWeekView>" },
        { command: "planning backlog", kind: "query", summary: "Return unscheduled or backlog tasks grouped for planning work.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [queryFlag, limitFlag, formatFlag], returns: "ListResult<Task>" },
        { command: "planning agenda", kind: "query", summary: "Return the agenda view centered on calendar items and linked tasks.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "date", type: "date", description: "Optional date." }, formatFlag], returns: "EntityResult<AgendaView>" },
        { command: "planning window", kind: "query", summary: "Return a planning view over an explicit date window with due ranges and scheduled work.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "from", type: "date", description: "Inclusive lower bound.", required: true }, { name: "to", type: "date", description: "Inclusive upper bound.", required: true }, formatFlag], returns: "EntityResult<PlanningWindowView>" },
      ],
    },
    project: {
      summary: "Project CRUD and queries for the planning domain.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
      commands: [
        { command: "project list", kind: "query", summary: "List projects.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [...listFlags, { name: "status", type: "string[]", description: "Project status filter." }], returns: "ListResult<Project>" },
        { command: "project get", kind: "query", summary: "Get one project.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "project-id", type: "id", required: true, description: "Project id." }], flags: [includeContextFlag, formatFlag], returns: "EntityResult<Project>" },
        { command: "project create", kind: "mutation", summary: "Create a project.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "name", type: "string", description: "Project name.", required: true }, { name: "description", type: "markdown", description: "Project description." }, formatFlag], returns: "ActionResult", emitsActivity: ["project.created"] },
        { command: "project update", kind: "mutation", summary: "Update a project.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "project-id", type: "id", required: true, description: "Project id." }], flags: [{ name: "name", type: "string", description: "New project name." }, { name: "status", type: "string", description: "New project status." }, { name: "description", type: "markdown", description: "New description." }, formatFlag], returns: "ActionResult", emitsActivity: ["project.updated"] },
        { command: "project archive", kind: "mutation", summary: "Archive a project.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "project-id", type: "id", required: true, description: "Project id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["project.archived"] },
        { command: "project delete", kind: "mutation", summary: "Delete a project.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "project-id", type: "id", required: true, description: "Project id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["project.deleted"] },
      ],
    },
    label: {
      summary: "Label CRUD and queries for the planning domain.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
      commands: [
        { command: "label list", kind: "query", summary: "List labels.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [...listFlags], returns: "ListResult<Label>" },
        { command: "label get", kind: "query", summary: "Get one label.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "label-id", type: "id", required: true, description: "Label id." }], flags: [formatFlag], returns: "EntityResult<Label>" },
        { command: "label create", kind: "mutation", summary: "Create a label.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "name", type: "string", description: "Label name.", required: true }, { name: "color", type: "string", description: "Optional color." }, formatFlag], returns: "ActionResult", emitsActivity: ["label.created"] },
        { command: "label update", kind: "mutation", summary: "Update a label.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "label-id", type: "id", required: true, description: "Label id." }], flags: [{ name: "name", type: "string", description: "New label name." }, { name: "color", type: "string", description: "New color." }, formatFlag], returns: "ActionResult", emitsActivity: ["label.updated"] },
        { command: "label archive", kind: "mutation", summary: "Archive a label.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "label-id", type: "id", required: true, description: "Label id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["label.archived"] },
        { command: "label delete", kind: "mutation", summary: "Delete a label.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "label-id", type: "id", required: true, description: "Label id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["label.deleted"] },
      ],
    },
    task: {
      summary: "Task queries and mutations for the first-party planning domain.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
      commands: [
        { command: "task list", kind: "query", summary: "List tasks.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [...listFlags, { name: "status", type: "string[]", description: "Task status filter." }, { name: "project", type: "id[]", description: "Project filter." }, { name: "label", type: "id[]", description: "Label filter." }, { name: "due", type: "enum", enumValues: ["today", "overdue", "upcoming", "none"] as const, description: "Due-window filter." }], returns: "ListResult<Task>" },
        { command: "task get", kind: "query", summary: "Get one task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<Task>" },
        { command: "task create", kind: "mutation", summary: "Create a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "title", type: "string", description: "Task title.", required: true }, { name: "description", type: "markdown", description: "Task description." }, { name: "project", type: "id", description: "Project id." }, { name: "labels", type: "id[]", description: "Label ids." }, { name: "priority", type: "string", description: "Priority." }, { name: "due-from", type: "datetime", description: "Due window start." }, { name: "due-at", type: "datetime", description: "Due window end." }, { name: "blocked-by", type: "id[]", description: "Initial blocking task ids." }, { name: "recurrence-rule", type: "string", description: "Recurrence rule for the task series." }, { name: "recurrence-start", type: "date", description: "Recurrence series start date." }, { name: "recurrence-end", type: "date", description: "Recurrence series end date." }, formatFlag], returns: "ActionResult", emitsActivity: ["task.created"] },
        { command: "task update", kind: "mutation", summary: "Update a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [{ name: "title", type: "string", description: "New title." }, { name: "description", type: "markdown", description: "New description." }, { name: "status", type: "string", description: "New status." }, { name: "priority", type: "string", description: "New priority." }, { name: "project", type: "id", description: "Project id." }, { name: "labels", type: "id[]", description: "Replacement label ids." }, { name: "due-from", type: "datetime", description: "Due window start." }, { name: "due-at", type: "datetime", description: "Due window end." }, { name: "blocked-by", type: "id[]", description: "Replacement blocking task ids." }, { name: "recurrence-rule", type: "string", description: "Replacement recurrence rule." }, { name: "recurrence-start", type: "date", description: "Recurrence series start date." }, { name: "recurrence-end", type: "date", description: "Recurrence series end date." }, formatFlag], returns: "ActionResult", emitsActivity: ["task.updated"] },
        { command: "task complete", kind: "mutation", summary: "Mark a task done.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.completed"] },
        { command: "task reopen", kind: "mutation", summary: "Reopen a completed or canceled task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.reopened"] },
        { command: "task cancel", kind: "mutation", summary: "Cancel a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.canceled"] },
        { command: "task archive", kind: "mutation", summary: "Archive a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.archived"] },
        { command: "task delete", kind: "mutation", summary: "Delete a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.deleted"] },
        { command: "task block", kind: "mutation", summary: "Add one or more blocking task edges.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Blocked task id." }], flags: [{ name: "blocked-by", type: "id[]", description: "Blocking task ids.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["task.blocked"] },
        { command: "task unblock", kind: "mutation", summary: "Remove one or more blocking task edges.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [{ name: "blocked-by", type: "id[]", description: "Blocking task ids to remove.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["task.unblocked"] },
        { command: "task schedule", kind: "workflow", summary: "Create or update a linked calendar item for a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [{ name: "start", type: "datetime", description: "Scheduled start.", required: true }, { name: "end", type: "datetime", description: "Scheduled end.", required: true }, { name: "calendar-item-id", type: "id", description: "Existing linked calendar item to reuse." }, formatFlag], returns: "ActionResult", emitsActivity: ["task.scheduled", "calendar.updated"] },
        { command: "task unschedule", kind: "mutation", summary: "Remove a linked calendar item from a task or clear its scheduling association.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [{ name: "calendar-item-id", type: "id", description: "Specific linked item to detach." }, formatFlag], returns: "ActionResult", emitsActivity: ["task.unscheduled"] },
        { command: "task recurrence clear", kind: "mutation", summary: "Remove recurrence metadata from a task series root.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.recurrence.cleared"] },
        { command: "task occurrences", kind: "query", summary: "List occurrences generated from a recurring task series.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task series root id." }], flags: [{ name: "from", type: "date", description: "Inclusive lower bound." }, { name: "to", type: "date", description: "Inclusive upper bound." }, limitFlag, formatFlag], returns: "ListResult<Task>" },
        { command: "task restore", kind: "mutation", summary: "Restore a task to a prior preserved revision.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "task-id", type: "id", required: true, description: "Task id." }, revisionArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["task.restored"] },
        { command: "task sync", kind: "workflow", summary: "Run Google Tasks sync for one task or for the task domain.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "task-id", type: "id", description: "Optional task id." }, { name: "mode", type: "enum", enumValues: ["push", "pull", "reconcile"] as const, description: "Sync mode.", defaultValue: "reconcile" }, formatFlag], returns: "ActionResult", emitsActivity: ["task.synced"] },
      ],
    },
    calendar: {
      summary: "Calendar item queries and mutations for the first-party planning domain.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"],
      commands: [
        { command: "calendar list", kind: "query", summary: "List calendar items.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [...listFlags, { name: "kind", type: "string[]", description: "Calendar item kind filter." }, { name: "date-from", type: "date", description: "Lower day bound." }, { name: "date-to", type: "date", description: "Upper day bound." }], returns: "ListResult<CalendarItem>" },
        { command: "calendar get", kind: "query", summary: "Get one calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<CalendarItem>" },
        { command: "calendar create", kind: "mutation", summary: "Create a calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "title", type: "string", description: "Calendar title.", required: true }, { name: "start", type: "datetime", description: "Start datetime.", required: true }, { name: "end", type: "datetime", description: "End datetime.", required: true }, { name: "kind", type: "string", description: "Item kind." }, { name: "task-id", type: "id", description: "Optional linked task id." }, { name: "description", type: "markdown", description: "Calendar item description." }, { name: "location", type: "string", description: "Calendar item location." }, { name: "all-day", type: "boolean", description: "Create as an all-day item.", defaultValue: false }, { name: "recurrence-rule", type: "string", description: "Recurrence rule for the calendar series." }, { name: "recurrence-start", type: "date", description: "Recurrence series start date." }, { name: "recurrence-end", type: "date", description: "Recurrence series end date." }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.created"] },
        { command: "calendar update", kind: "mutation", summary: "Update a calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [{ name: "title", type: "string", description: "New title." }, { name: "start", type: "datetime", description: "New start datetime." }, { name: "end", type: "datetime", description: "New end datetime." }, { name: "status", type: "string", description: "New status." }, { name: "description", type: "markdown", description: "New description." }, { name: "location", type: "string", description: "New location." }, { name: "all-day", type: "boolean", description: "Whether this item is all-day." }, { name: "recurrence-rule", type: "string", description: "Replacement recurrence rule." }, { name: "recurrence-start", type: "date", description: "Recurrence series start date." }, { name: "recurrence-end", type: "date", description: "Recurrence series end date." }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.updated"] },
        { command: "calendar move", kind: "mutation", summary: "Reschedule a calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [{ name: "start", type: "datetime", description: "New start datetime.", required: true }, { name: "end", type: "datetime", description: "New end datetime.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.moved"] },
        { command: "calendar confirm", kind: "mutation", summary: "Mark a calendar item confirmed.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["calendar.confirmed"] },
        { command: "calendar cancel", kind: "mutation", summary: "Cancel a calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["calendar.canceled"] },
        { command: "calendar delete", kind: "mutation", summary: "Delete a calendar item.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["calendar.deleted"] },
        { command: "calendar link-task", kind: "mutation", summary: "Link a calendar item to a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [{ name: "task-id", type: "id", description: "Task id.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.task.linked"] },
        { command: "calendar unlink-task", kind: "mutation", summary: "Unlink a calendar item from a task.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }], flags: [{ name: "task-id", type: "id", description: "Task id.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.task.unlinked"] },
        { command: "calendar recurrence clear", kind: "mutation", summary: "Remove recurrence metadata from a calendar series root.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar series root id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["calendar.recurrence.cleared"] },
        { command: "calendar occurrences", kind: "query", summary: "List occurrences generated from a recurring calendar item series.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar series root id." }], flags: [{ name: "from", type: "date", description: "Inclusive lower bound." }, { name: "to", type: "date", description: "Inclusive upper bound." }, limitFlag, formatFlag], returns: "ListResult<CalendarItem>" },
        { command: "calendar restore", kind: "mutation", summary: "Restore a calendar item to a prior preserved revision.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], args: [{ name: "calendar-item-id", type: "id", required: true, description: "Calendar item id." }, revisionArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["calendar.restored"] },
        { command: "calendar sync", kind: "workflow", summary: "Run Google Calendar sync for one item or for the calendar domain.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/calendar_tasks_api.md"], flags: [{ name: "calendar-item-id", type: "id", description: "Optional calendar item id." }, { name: "mode", type: "enum", enumValues: ["push", "pull", "reconcile"] as const, description: "Sync mode.", defaultValue: "reconcile" }, formatFlag], returns: "ActionResult", emitsActivity: ["calendar.synced"] },
      ],
    },
    email: {
      summary: "Provider-canonical agent mailbox operations with selective local caches and triage metadata.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"],
      commands: [
        { command: "email account status", kind: "query", summary: "Return email account connection, validation, and sync status.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: [formatFlag], returns: "EntityResult<EmailAccount>" },
        { command: "email thread list", kind: "query", summary: "List email threads from the agent mailbox.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: [...listFlags, queryFlag, { name: "label", type: "string[]", description: "Provider label filter." }, { name: "triage-state", type: "string[]", description: "Origin triage-state filter." }], returns: "ListResult<EmailThread>" },
        { command: "email thread get", kind: "query", summary: "Get an email thread with its messages, triage record, and provenance metadata.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Email thread id." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<EmailThread>" },
        { command: "email thread search", kind: "query", summary: "Search the email domain.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: searchFlags, returns: "ListResult<EmailThread>" },
        { command: "email message get", kind: "query", summary: "Get a single message, including body, headers, and attachments metadata when available.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "message-id", type: "id", required: true, description: "Email message id." }], flags: [includeContextFlag, formatFlag], returns: "EntityResult<EmailMessage>" },
        { command: "email attachment get", kind: "query", summary: "Get one email attachment record and access metadata for cached content if present.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "attachment-id", type: "id", required: true, description: "Attachment id." }], flags: [formatFlag], returns: "EntityResult<EmailAttachment>" },
        { command: "email draft create", kind: "mutation", summary: "Create an email draft.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: [{ name: "to", type: "string[]", description: "Recipient addresses.", required: true }, { name: "subject", type: "string", description: "Draft subject.", required: true }, { name: "body", type: "markdown", description: "Draft body.", required: true }, { name: "thread-id", type: "id", description: "Optional thread id for reply context." }, formatFlag], returns: "ActionResult", emitsActivity: ["email.draft.created"] },
        { command: "email draft update", kind: "mutation", summary: "Update an email draft.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "draft-id", type: "id", required: true, description: "Draft id." }], flags: [{ name: "to", type: "string[]", description: "Recipient addresses." }, { name: "subject", type: "string", description: "Updated subject." }, { name: "body", type: "markdown", description: "Updated body." }, formatFlag], returns: "ActionResult", emitsActivity: ["email.draft.updated"] },
        { command: "email draft delete", kind: "mutation", summary: "Delete an email draft.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "draft-id", type: "id", required: true, description: "Draft id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.draft.deleted"] },
        { command: "email send", kind: "mutation", summary: "Send a new email.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: [{ name: "to", type: "string[]", description: "Recipient addresses.", required: true }, { name: "subject", type: "string", description: "Message subject.", required: true }, { name: "body", type: "markdown", description: "Message body.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["email.sent"] },
        { command: "email reply", kind: "mutation", summary: "Reply to an email thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [{ name: "body", type: "markdown", description: "Reply body.", required: true }, { name: "reply-all", type: "boolean", description: "Reply to all recipients.", defaultValue: false }, formatFlag], returns: "ActionResult", emitsActivity: ["email.replied"] },
        { command: "email archive", kind: "mutation", summary: "Archive an email thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.archived"] },
        { command: "email unarchive", kind: "mutation", summary: "Return an archived email thread to the inbox.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.unarchived"] },
        { command: "email mark-read", kind: "mutation", summary: "Mark an email thread read.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.marked_read"] },
        { command: "email mark-unread", kind: "mutation", summary: "Mark an email thread unread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.marked_unread"] },
        { command: "email label add", kind: "mutation", summary: "Add provider labels to an email thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [{ name: "labels", type: "string[]", description: "Provider labels.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["email.labels.updated"] },
        { command: "email label remove", kind: "mutation", summary: "Remove provider labels from an email thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [{ name: "labels", type: "string[]", description: "Provider labels.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["email.labels.updated"] },
        { command: "email triage get", kind: "query", summary: "Get Origin triage state for an email thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "EntityResult<EmailTriageRecord>" },
        { command: "email triage set", kind: "mutation", summary: "Set Origin triage metadata for a thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [{ name: "state", type: "string", description: "Triage state.", required: true }, { name: "follow-up-at", type: "datetime", description: "Follow-up time." }, { name: "linked-task-id", type: "id", description: "Linked task." }, formatFlag], returns: "ActionResult", emitsActivity: ["email.triage.updated"] },
        { command: "email triage clear", kind: "mutation", summary: "Clear Origin triage metadata for a thread.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], args: [{ name: "thread-id", type: "id", required: true, description: "Thread id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["email.triage.cleared"] },
        { command: "email sync refresh", kind: "workflow", summary: "Refresh recent email state and selective caches from the provider.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/email_api.md"], flags: [sinceFlag, formatFlag], returns: "ActionResult", emitsActivity: ["email.synced"] },
      ],
    },
    github: {
      summary: "Selective GitHub follow-up, tracking, and direct actions.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"],
      commands: [
        { command: "github repo list", kind: "query", summary: "List tracked or recently relevant repositories.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [...listFlags, queryFlag, { name: "tracked", type: "boolean", description: "Filter to tracked repos.", defaultValue: false }], returns: "ListResult<GitHubRepository>" },
        { command: "github repo get", kind: "query", summary: "Get one repository and its local follow configuration.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "repo-id-or-name", type: "string", required: true, description: "Stable repo id or owner/name." }], flags: [includeContextFlag, formatFlag], returns: "EntityResult<GitHubRepository>" },
        { command: "github repo track", kind: "mutation", summary: "Track a repository locally for follow-up.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "repo-id-or-name", type: "string", required: true, description: "Repo id or owner/name." }], flags: [{ name: "reason", type: "string", description: "Why this repo is tracked." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.repo.tracked"] },
        { command: "github repo untrack", kind: "mutation", summary: "Stop tracking a repository locally.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "repo-id-or-name", type: "string", required: true, description: "Repo id or owner/name." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["github.repo.untracked"] },
        { command: "github follow list", kind: "query", summary: "List Origin follow targets across tracked repositories, issues, and pull requests.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [...listFlags, { name: "repo", type: "string[]", description: "Repository filters." }, { name: "kind", type: "string[]", description: "Follow-target kind filter." }], returns: "ListResult<GitHubFollowTarget>" },
        { command: "github follow set", kind: "mutation", summary: "Create or update a GitHub follow target with local tracking rules.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [{ name: "repo", type: "string", description: "Repository owner/name.", required: true }, { name: "kind", type: "enum", enumValues: ["repo", "issue", "pr"] as const, description: "Follow-target kind.", required: true }, { name: "target-ref", type: "string", description: "Optional issue or PR ref when kind is not repo." }, { name: "reason", type: "string", description: "Why this follow target matters." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.follow.updated"] },
        { command: "github issue list", kind: "query", summary: "List issues across tracked repositories or a specific repository.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [...listFlags, queryFlag, { name: "repo", type: "string[]", description: "Repository filters." }, { name: "state", type: "string[]", description: "Issue state filters." }], returns: "ListResult<GitHubIssueSnapshot>" },
        { command: "github issue get", kind: "query", summary: "Get one issue with comments and local tracking metadata.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "issue-ref", type: "string", required: true, description: "Issue ref such as owner/name#123." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<GitHubIssueSnapshot>" },
        { command: "github issue create", kind: "mutation", summary: "Create a GitHub issue.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [{ name: "repo", type: "string", description: "Repository owner/name.", required: true }, { name: "title", type: "string", description: "Issue title.", required: true }, { name: "body", type: "markdown", description: "Issue body." }, { name: "labels", type: "string[]", description: "Issue labels." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.issue.created"] },
        { command: "github issue update", kind: "mutation", summary: "Update an issue title, body, or labels.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "issue-ref", type: "string", required: true, description: "Issue ref." }], flags: [{ name: "title", type: "string", description: "New title." }, { name: "body", type: "markdown", description: "New body." }, { name: "labels", type: "string[]", description: "Replacement labels." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.issue.updated"] },
        { command: "github issue comment", kind: "mutation", summary: "Comment on an issue.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "issue-ref", type: "string", required: true, description: "Issue ref." }], flags: [{ name: "body", type: "markdown", description: "Comment body.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["github.issue.commented"] },
        { command: "github issue close", kind: "mutation", summary: "Close an issue.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "issue-ref", type: "string", required: true, description: "Issue ref." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["github.issue.closed"] },
        { command: "github issue reopen", kind: "mutation", summary: "Reopen an issue.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "issue-ref", type: "string", required: true, description: "Issue ref." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["github.issue.reopened"] },
        { command: "github pr list", kind: "query", summary: "List pull requests across tracked repositories or a specific repository.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [...listFlags, queryFlag, { name: "repo", type: "string[]", description: "Repository filters." }, { name: "state", type: "string[]", description: "PR state filters." }], returns: "ListResult<GitHubPullRequestSnapshot>" },
        { command: "github pr get", kind: "query", summary: "Get one pull request with reviews, comments, and tracking metadata.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "pr-ref", type: "string", required: true, description: "PR ref such as owner/name#456." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<GitHubPullRequestSnapshot>" },
        { command: "github pr open", kind: "mutation", summary: "Open a pull request when the branch state already exists upstream.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [{ name: "repo", type: "string", description: "Repository owner/name.", required: true }, { name: "head", type: "string", description: "Head ref.", required: true }, { name: "base", type: "string", description: "Base ref.", required: true }, { name: "title", type: "string", description: "PR title.", required: true }, { name: "body", type: "markdown", description: "PR body." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.pr.opened"] },
        { command: "github pr update", kind: "mutation", summary: "Update a pull request title or body.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "pr-ref", type: "string", required: true, description: "PR ref." }], flags: [{ name: "title", type: "string", description: "New title." }, { name: "body", type: "markdown", description: "New body." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.pr.updated"] },
        { command: "github pr comment", kind: "mutation", summary: "Comment on a pull request conversation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "pr-ref", type: "string", required: true, description: "PR ref." }], flags: [{ name: "body", type: "markdown", description: "Comment body.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["github.pr.commented"] },
        { command: "github review submit", kind: "mutation", summary: "Submit a pull request review.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "pr-ref", type: "string", required: true, description: "PR ref." }], flags: [{ name: "event", type: "enum", enumValues: ["comment", "approve", "request-changes"] as const, description: "Review event.", required: true }, { name: "body", type: "markdown", description: "Review body." }, formatFlag], returns: "ActionResult", emitsActivity: ["github.review.submitted"] },
        { command: "github pr merge", kind: "mutation", summary: "Merge a pull request when mergeability checks pass.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], args: [{ name: "pr-ref", type: "string", required: true, description: "PR ref." }], flags: [{ name: "method", type: "enum", enumValues: ["merge", "squash", "rebase"] as const, description: "Merge method.", defaultValue: "squash" }, formatFlag], returns: "ActionResult", emitsActivity: ["github.pr.merged"] },
        { command: "github search", kind: "query", summary: "Search GitHub issues, pull requests, repositories, or comments within the tracked working set or globally where supported.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [queryFlag, { name: "scope", type: "enum", enumValues: ["repo", "issue", "pr", "comment"] as const, description: "Search scope.", required: true }, limitFlag, formatFlag], returns: "ListResult<SearchResult>" },
        { command: "github sync", kind: "workflow", summary: "Refresh tracked GitHub state and caches.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/github_api.md"], flags: [{ name: "repo", type: "string[]", description: "Optional repository filters." }, sinceFlag, formatFlag], returns: "ActionResult", emitsActivity: ["github.synced"] },
      ],
    },
    telegram: {
      summary: "Bot-based Telegram operations for group participation, summaries, and direct actions.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"],
      commands: [
        { command: "telegram connection status", kind: "query", summary: "Return bot token validity, privacy mode, and connection health.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [formatFlag], returns: "EntityResult<TelegramBotConnection>" },
        { command: "telegram connection set-token", kind: "mutation", summary: "Set or replace the Telegram bot token.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [{ name: "token", type: "string", description: "Bot token from BotFather.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.connection.updated"] },
        { command: "telegram connection validate", kind: "workflow", summary: "Validate the Telegram bot token and bot configuration.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [formatFlag], returns: "ValidationResult", emitsActivity: ["telegram.connection.validated"] },
        { command: "telegram connection configure", kind: "mutation", summary: "Configure Telegram bot behavior that Origin tracks, such as privacy expectations or default participation stance.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [{ name: "privacy-mode", type: "enum", enumValues: ["enabled", "disabled", "unknown"] as const, description: "Observed or intended privacy-mode state." }, { name: "default-mode", type: "enum", enumValues: ["observe", "participate", "summarize"] as const, description: "Default participation mode for newly enabled groups." }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.connection.configured"] },
        { command: "telegram chat list", kind: "query", summary: "List known Telegram chats and groups relevant to the bot.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [...listFlags, queryFlag, { name: "kind", type: "string[]", description: "Chat kind filter." }], returns: "ListResult<TelegramChatRef>" },
        { command: "telegram chat get", kind: "query", summary: "Get one Telegram chat with cached recent messages and subscription state.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [includeContextFlag, formatFlag], returns: "EntityResult<TelegramChatRef>" },
        { command: "telegram chat refresh", kind: "workflow", summary: "Refresh recent cached state for one chat or for the Telegram working set.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [{ name: "chat-id", type: "id", description: "Optional chat id." }, sinceFlag, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.cache.refreshed"] },
        { command: "telegram group enable", kind: "mutation", summary: "Enable a Telegram group for observation, summaries, or participation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [{ name: "mode", type: "enum", enumValues: ["observe", "participate", "summarize"] as const, description: "Participation mode.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.group.enabled"] },
        { command: "telegram group disable", kind: "mutation", summary: "Disable a Telegram group subscription.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["telegram.group.disabled"] },
        { command: "telegram group mode set", kind: "mutation", summary: "Change the participation mode for an already enabled Telegram group.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [{ name: "mode", type: "enum", enumValues: ["observe", "participate", "summarize"] as const, description: "New participation mode.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.group.mode.updated"] },
        { command: "telegram group summarize", kind: "workflow", summary: "Generate a summary for a Telegram group over a given recent window.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [{ name: "window", type: "duration", description: "Recent window to summarize.", defaultValue: "24h" }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.group.summarized"] },
        { command: "telegram message send", kind: "mutation", summary: "Send a Telegram bot message to a chat.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }], flags: [{ name: "body", type: "markdown", description: "Message body.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.message.sent"] },
        { command: "telegram message reply", kind: "mutation", summary: "Reply to a Telegram message within a chat.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], args: [{ name: "chat-id", type: "id", required: true, description: "Telegram chat id." }, { name: "message-id", type: "id", required: true, description: "Telegram message id." }], flags: [{ name: "body", type: "markdown", description: "Reply body.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.message.replied"] },
        { command: "telegram cache refresh", kind: "workflow", summary: "Refresh Telegram recent-message caches without changing subscription state.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [sinceFlag, formatFlag], returns: "ActionResult", emitsActivity: ["telegram.cache.refreshed"] },
        { command: "telegram summaries", kind: "query", summary: "List recent Telegram summary jobs and their outputs.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/telegram_api.md"], flags: [{ name: "chat-id", type: "id", description: "Optional chat filter." }, sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ListResult<TelegramSummaryJobRecord>" },
      ],
    },
    automation: {
      summary: "First-class automation objects, runs, and events.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"],
      commands: [
        { command: "automation list", kind: "query", summary: "List automations.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], flags: [...listFlags, { name: "status", type: "string[]", description: "Automation status filter." }, { name: "trigger", type: "string[]", description: "Trigger kind filter." }, { name: "linked-task", type: "id[]", description: "Linked task filter." }], returns: "ListResult<Automation>" },
        { command: "automation get", kind: "query", summary: "Get one automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<Automation>" },
        { command: "automation create", kind: "mutation", summary: "Create an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], flags: [{ name: "title", type: "string", description: "Automation title.", required: true }, { name: "kind", type: "string", description: "Automation kind.", required: true }, { name: "trigger", type: "json", description: "Trigger definition.", required: true }, { name: "actions", type: "json", description: "Action definitions.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["automation.created"] },
        { command: "automation update", kind: "mutation", summary: "Update an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [{ name: "title", type: "string", description: "New title." }, { name: "trigger", type: "json", description: "Replacement trigger." }, { name: "actions", type: "json", description: "Replacement actions." }, { name: "notification-policy", type: "json", description: "Notification policy patch." }, { name: "retry-policy", type: "json", description: "Retry policy patch." }, formatFlag], returns: "ActionResult", emitsActivity: ["automation.updated"] },
        { command: "automation archive", kind: "mutation", summary: "Archive an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.archived"] },
        { command: "automation delete", kind: "mutation", summary: "Delete an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.deleted"] },
        { command: "automation enable", kind: "mutation", summary: "Enable an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.enabled"] },
        { command: "automation disable", kind: "mutation", summary: "Disable an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.disabled"] },
        { command: "automation pause", kind: "mutation", summary: "Pause an automation without deleting it.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.paused"] },
        { command: "automation resume", kind: "mutation", summary: "Resume a paused automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.resumed"] },
        { command: "automation run", kind: "workflow", summary: "Run an automation immediately.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [{ name: "reason", type: "string", description: "Manual trigger reason." }, formatFlag], returns: "ActionResult", emitsActivity: ["automation.run.started", "automation.run.completed"] },
        { command: "automation skip-next", kind: "mutation", summary: "Skip the next scheduled run of an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.next_run.skipped"] },
        { command: "automation runs", kind: "query", summary: "List runs for an automation.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "automation-id", type: "id", required: true, description: "Automation id." }], flags: [sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ListResult<AutomationRun>" },
        { command: "automation run get", kind: "query", summary: "Get one automation run with action-by-action execution details.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "run-id", type: "id", required: true, description: "Automation run id." }], flags: [formatFlag], returns: "EntityResult<AutomationRun>" },
        { command: "automation retry", kind: "workflow", summary: "Retry a failed automation run or requeue its failed actions.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], args: [{ name: "run-id", type: "id", required: true, description: "Automation run id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["automation.run.retried"] },
        { command: "automation events", kind: "query", summary: "List activity events for automations.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/api/automation_api.md"], flags: [{ name: "automation-id", type: "id", description: "Optional automation filter." }, sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ActivityStream" },
      ],
    },
    activity: {
      summary: "User-visible activity-event log across the system.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        { command: "activity list", kind: "query", summary: "List recent activity events.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ActivityStream" },
        { command: "activity get", kind: "query", summary: "Get one activity event.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "activity-id", type: "id", required: true, description: "Activity event id." }], flags: [formatFlag], returns: "EntityResult<ActivityEvent>" },
        { command: "activity tail", kind: "query", summary: "Stream or poll recent activity events for agent awareness or UI updates.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [{ name: "follow", type: "boolean", description: "Follow new events.", defaultValue: true }, domainsFlag, formatFlag], returns: "ActivityStream" },
        { command: "activity summarize", kind: "query", summary: "Summarize recent activity across a time window.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, sinceFlag, untilFlag, formatFlag], returns: "EntityResult<ActivitySummary>" },
      ],
    },
    entity: {
      summary: "Cross-domain entity graph operations, including links and history.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        { command: "entity get", kind: "query", summary: "Resolve and return any Origin entity by id or ref.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [includeContextFlag, includeActivityFlag, formatFlag], returns: "EntityResult<OriginEntity>" },
        { command: "entity related", kind: "query", summary: "List linked or contextually related entities.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [domainsFlag, limitFlag, formatFlag], returns: "ListResult<OriginEntity>" },
        { command: "entity history", kind: "query", summary: "Return object-level history for an entity where supported.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [sinceFlag, untilFlag, formatFlag], returns: "ListResult<EntityHistoryEntry>" },
        { command: "entity link", kind: "mutation", summary: "Create an Origin-side cross-domain link between two entities.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [{ name: "to", type: "id", description: "Target entity ref.", required: true }, { name: "kind", type: "string", description: "Link kind.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["entity.link.created"] },
        { command: "entity unlink", kind: "mutation", summary: "Remove an Origin-side cross-domain link.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg], flags: [{ name: "to", type: "id", description: "Target entity ref.", required: true }, { name: "kind", type: "string", description: "Link kind.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["entity.link.deleted"] },
        { command: "entity restore", kind: "mutation", summary: "Restore a first-party entity to a prior preserved revision where the domain supports it.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [entityRefArg, revisionArg], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["entity.restored"] },
      ],
    },
    notification: {
      summary: "Origin in-app and push notification state.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        { command: "notification list", kind: "query", summary: "List user notifications.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ListResult<Notification>" },
        { command: "notification get", kind: "query", summary: "Get one notification.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "notification-id", type: "id", required: true, description: "Notification id." }], flags: [formatFlag], returns: "EntityResult<Notification>" },
        { command: "notification ack", kind: "mutation", summary: "Acknowledge or mark a notification as read.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "notification-id", type: "id", required: true, description: "Notification id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["notification.acknowledged"] },
        { command: "notification snooze", kind: "mutation", summary: "Snooze a notification.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "notification-id", type: "id", required: true, description: "Notification id." }], flags: [{ name: "until", type: "datetime", description: "Snooze-until timestamp.", required: true }, formatFlag], returns: "ActionResult", emitsActivity: ["notification.snoozed"] },
        { command: "notification test", kind: "workflow", summary: "Send a test in-app/push notification through Origin surfaces.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/onboarding.md"], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["notification.test.sent"] },
      ],
    },
    sync: {
      summary: "Replication and provider-sync observability.",
      sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"],
      commands: [
        { command: "sync status", kind: "query", summary: "Return sync status for local-first replication and provider refresh jobs.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, formatFlag], returns: "EntityResult<SyncStatus>" },
        { command: "sync peers", kind: "query", summary: "List known replication peers and their recent sync state.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [formatFlag], returns: "ListResult<PeerSyncStatus>" },
        { command: "sync run", kind: "workflow", summary: "Trigger a sync pass for one or more scopes.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, formatFlag], returns: "ActionResult", emitsActivity: ["sync.ran"] },
        { command: "sync jobs", kind: "query", summary: "List recent sync jobs and provider-refresh jobs.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, sinceFlag, untilFlag, limitFlag, formatFlag], returns: "ListResult<SyncJob>" },
        { command: "sync conflicts", kind: "query", summary: "List outstanding sync conflicts across domains.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], flags: [domainsFlag, limitFlag, formatFlag], returns: "ListResult<SyncConflict>" },
        { command: "sync conflict get", kind: "query", summary: "Get one sync conflict with the competing revisions, peers, and affected entities.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [conflictArg], flags: [formatFlag], returns: "EntityResult<SyncConflict>" },
        { command: "sync conflict resolve", kind: "mutation", summary: "Resolve a sync conflict by selecting a resolution strategy or explicit merged payload.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [conflictArg], flags: [{ name: "strategy", type: "enum", enumValues: ["ours", "theirs", "merge", "replace"] as const, description: "Conflict-resolution strategy.", required: true }, { name: "payload", type: "json", description: "Resolved structured payload when using `merge` or `replace`." }, formatFlag], returns: "ActionResult", emitsActivity: ["sync.conflict.resolved"] },
        { command: "sync retry", kind: "workflow", summary: "Retry a failed sync job or provider refresh.", sourceDocs: ["/Users/polarzero/code/projects/origin/docs/prd.md"], args: [{ name: "job-id", type: "id", required: true, description: "Sync job id." }], flags: [formatFlag], returns: "ActionResult", emitsActivity: ["sync.retried"] },
      ],
    },
  },
} satisfies OriginCliSpec;

export type OriginCliNamespace = keyof typeof originCliSpec.namespaces;
export type OriginCliCommand =
  (typeof originCliSpec.namespaces)[OriginCliNamespace]["commands"][number]["command"];
