# Slice 1 Local Runbook

## Commands

- `make setup`: install JS dependencies, start Postgres and PowerSync, migrate, and seed the development identity.
- `make up`: start Postgres and PowerSync, then run migrations and seed the development identity.
- `make down`: stop Postgres and PowerSync without deleting local database state.
- `make dev`: start local services and run the backend at `http://127.0.0.1:3000`.
- `make doctor`: validate Xcode, an iOS simulator SDK, and the concrete iPhone 13 Pro iOS 18 simulator destination used by E2E.
- `make build-macos`: build the macOS app at `native/DerivedData/Build/Products/Debug/OriginMac.app`.
- `make run-macos`: build and open the macOS app.
- `make build-ios`: build the iOS simulator app at `native/Origin/build/Debug-iphonesimulator/Origin.app`.
- `make run-ios`: build, install, and launch the iOS app on the iPhone 13 Pro iOS 18 simulator.
- `make test`: start services, run migrations/seeds, and execute backend tests.
- `make e2e`: start services, build the iOS UI test target for simulator, run XCTest UI automation on the iPhone 13 Pro iOS 18 simulator, verify the diagnostics screen, and verify the native app requested PowerSync credentials.
- `make reset`: delete Docker volumes, backend logs, and local derived data.

## Logs

- Backend: `.logs/backend.log` after `make dev` or `make e2e`.
- PowerSync: `make logs-powersync`.
- Postgres: `make logs-postgres`.

All backend responses include `x-correlation-id`. Passing this header from the native app or a test keeps the same ID in backend logs.

## Development Identity

Slice 1 seeds exactly one user and one device:

- User ID: `dev_user`
- Device ID: `dev_device`

The native diagnostics screen uses these IDs when requesting PowerSync credentials. Slice 1 has no domain writes; `/v1/powersync/upload` exists only as the connector endpoint that later slices will replace with command-intent upload handling.

The native diagnostics screen verifies backend-issued PowerSync credentials and PowerSync service reachability. PowerSync-managed local SQLite sync is deferred to Slice 2 so it is implemented once against real notes data.
