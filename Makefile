VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.DEFAULT_GOAL := help

.PHONY: help setup db run up down logs demo dist web build dev serve check clean review-server screenshot

help: ## Show the targets
	@grep -hE '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{ printf "  %-14s %s\n", $$1, $$2 }'

setup: ## Install the Go and web dependencies, create .env
	@for tool in go node pnpm; do \
		command -v $$tool >/dev/null || { echo "$$tool is missing: install it first"; exit 1; }; \
	done
	go mod download
	cd web && pnpm install --frozen-lockfile
	[ -f .env ] || cp .env.example .env

db: ## Start PostgreSQL in Docker for a local run
	docker compose -f compose.yaml -f compose.dev.yaml up -d db
	@echo "Database: postgres://zotra:zotra@127.0.0.1:5432/zotra?sslmode=disable (put it in .env as ZOTRA_DATABASE_URL)"

run: build ## Build and run the app with .env
	set -a; . ./.env; set +a; ./zotra

up: ## Start Zotra with Docker compose
	docker compose up -d
	@for i in $$(seq 45); do \
		addr=$$(docker compose port app 8080 2>/dev/null); \
		if [ -n "$$addr" ] && curl -fsS "http://$$addr/api/health" >/dev/null 2>&1; then \
			echo "Zotra runs at http://$$addr"; exit 0; \
		fi; \
		sleep 2; \
	done; \
	echo "The app is not healthy: run make logs"; exit 1

down: ## Stop Zotra (the data stays)
	docker compose down

logs: ## Show the logs of the app
	docker compose logs -f app

demo: ## Fill the database with a demo history
	set -a; . ./.env; set +a; go run ./cmd/zotra-history

dist: ## Build the release archives locally (snapshot)
	@command -v goreleaser >/dev/null || { echo "goreleaser is missing: see https://goreleaser.com/install"; exit 1; }
	goreleaser release --snapshot --clean

web: ## Build the web app
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web ## Build the zotra binary
	go build -ldflags "-X main.version=$(VERSION)" -o zotra ./cmd/zotra

dev: ## Show how to run the app in development
	@echo "Run in two terminals: go run ./cmd/zotra"
	@echo "cd web && pnpm dev"

# serve runs the app on all interfaces, on one free port. Use it to
# test the app from another machine on the same network.
serve: build ## Run the app on all interfaces, on a free port
	@port=$$(python3 -c 'import socket; s=socket.socket(); s.bind(("0.0.0.0", 0)); print(s.getsockname()[1]); s.close()'); \
	ip=$$(hostname -I 2>/dev/null | cut -d" " -f1); \
	echo "The app listens on 0.0.0.0:$$port"; \
	echo "  this machine:    http://localhost:$$port"; \
	if [ -n "$$ip" ]; then echo "  other machines:  http://$$ip:$$port"; fi; \
	ZOTRA_ADDR="0.0.0.0:$$port" ./zotra

# review-server serves the main branch for review, on port 8090.
review-server: ## Serve the main branch for review, on port 8090
	scripts/review-server.sh

# screenshot captures one page of the working tree at 1366 x 768.
# Usage: make screenshot URL=/ OUT=file.png
screenshot: ## Capture one page at 1366 x 768 (URL=, OUT=)
	URL="$(URL)" OUT="$(OUT)" scripts/screenshot.sh

# Go packages to check. local/ holds work files that are not pushed.
GO_PKGS = $$(go list -e ./... | grep -v /local/)

check: web ## Run the lint, type checks and tests
	cd web && pnpm lint && pnpm typecheck && pnpm test
	go vet $(GO_PKGS)
	go test -p 1 -count=1 $(GO_PKGS)

clean: ## Remove the build output
	rm -rf zotra web/dist
