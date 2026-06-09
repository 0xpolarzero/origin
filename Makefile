SHELL := /bin/bash

.PHONY: setup doctor up down reset migrate seed dev test typecheck e2e logs-backend logs-powersync logs-postgres

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
