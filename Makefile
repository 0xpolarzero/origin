SHELL := /bin/bash

.PHONY: setup doctor up down reset migrate seed dev build-macos run-macos build-ios run-ios test typecheck e2e logs-backend logs-powersync logs-postgres

setup:
	bun install
	$(MAKE) up

doctor:
	bun run doctor

up:
	docker compose up -d --wait postgres
	bun run db:migrate
	bun run db:seed
	docker compose up -d powersync

down:
	docker compose down

reset:
	docker compose down -v
	rm -rf .logs native/DerivedData

migrate:
	bun run db:migrate

seed:
	bun run db:seed

dev:
	$(MAKE) up
	mkdir -p .logs
	bun run backend:dev 2>&1 | tee .logs/backend.log

build-macos:
	xcodebuild -project native/Origin/Origin.xcodeproj -scheme Origin-macOS -destination platform=macOS -configuration Debug -derivedDataPath native/DerivedData -quiet build
	@echo "macOS app: native/DerivedData/Build/Products/Debug/OriginMac.app"

run-macos: build-macos
	open native/DerivedData/Build/Products/Debug/OriginMac.app

build-ios:
	xcodebuild -project native/Origin/Origin.xcodeproj -target Origin-iOS -configuration Debug -sdk iphonesimulator -quiet build
	@echo "iOS simulator app: native/Origin/build/Debug-iphonesimulator/Origin.app"

run-ios: doctor build-ios
	bun run ios:run

test:
	$(MAKE) up
	bun test

typecheck:
	bun run typecheck

e2e:
	bun run e2e

logs-backend:
	tail -f .logs/backend.log

logs-powersync:
	docker compose logs -f powersync

logs-postgres:
	docker compose logs -f postgres
