# origin

Minimal Bun workspace scaffold for the Origin server.

## Layout

```text
origin/
  apps/
    server/
      src/
        index.ts
  ops/
    bootstrap/
    deploy/
    env/
    systemd/
```

## Requirements

- Bun 1.3.11

## Commands

```sh
bun install
bun run dev
bun run start
bun run format
bun run lint
bun run typecheck
bun run check
```

## Notes

- Only the TypeScript server workspace is set up for now.
- `apps/apple` is intentionally not scaffolded yet.
- `ops/` contains deployment and operator-facing boilerplate.
