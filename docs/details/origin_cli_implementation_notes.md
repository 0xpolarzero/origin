# Origin CLI Implementation Notes

This note preserves the small amount of useful material that came out of the
temporary `.codex-reports/` scratch files during the initial incur-based CLI
implementation on 2026-04-07.

This file is not the CLI source of truth.

Authoritative sources:
- Runtime contract: [apps/server/src/cli/spec.ts](/Users/polarzero/code/projects/origin/apps/server/src/cli/spec.ts)
- Stable docs entrypoint: [docs/api/origin_incur_cli.ts](/Users/polarzero/code/projects/origin/docs/api/origin_incur_cli.ts)

## Preserved From Scratch Reports

The only non-empty scratch artifact was a raw leaf-command inventory used as an
implementation checklist. It confirmed that the contract exposed 576 leaf
commands at implementation time.

Top-level leaf-command counts from that inventory:

| Domain | Leaf Commands |
| --- | ---: |
| `activity` | 12 |
| `automation` | 28 |
| `chat` | 8 |
| `context` | 6 |
| `email` | 67 |
| `entity` | 6 |
| `file` | 12 |
| `github` | 77 |
| `identity` | 11 |
| `integration` | 22 |
| `memory` | 22 |
| `note` | 22 |
| `notification` | 19 |
| `planning` | 115 |
| `search` | 5 |
| `setup` | 33 |
| `status` | 10 |
| `sync` | 32 |
| `telegram` | 43 |
| `workspace` | 26 |
| **Total** | **576** |

## Why The Raw Scratch Files Were Not Kept

The original `.codex-reports/` directory contained:
- one raw 576-line command checklist
- three empty files

The empty files were discarded.

The raw checklist was also discarded because it is derived data, not authored
documentation. Keeping the summarized counts here is useful; keeping a large
opaque dump next to the real contract is not.

## How To Regenerate

Full agent-facing command manifest:

```sh
PATH="/Users/polarzero/code/projects/origin/apps/server/bin:$PATH" origin --llms
```

Contract-to-handler coverage check:

```sh
bun -e 'import { Cli } from "incur"; import contractModule from "./apps/server/src/cli/spec.ts"; import { handlers } from "./apps/server/src/handlers/index.ts"; const commands = Cli.toCommands.get(contractModule); const isGroup = (entry) => Boolean(entry?._group && entry.commands instanceof Map); const collect = (map, prefix = []) => { const paths = []; for (const [name, entry] of map) { const next = [...prefix, name]; if (isGroup(entry)) paths.push(...collect(entry.commands, next)); else paths.push(next.join(" ")); } return paths; }; const contractPaths = collect(commands).sort(); const handlerKeys = Object.keys(handlers).filter((key) => !key.includes(".")).sort(); const missing = contractPaths.filter((path) => !handlerKeys.includes(path)); const extra = handlerKeys.filter((path) => !contractPaths.includes(path)); console.log(JSON.stringify({ contractLeafCommands: contractPaths.length, handlerLeafCommands: handlerKeys.length, missing, extra }, null, 2));'
```
