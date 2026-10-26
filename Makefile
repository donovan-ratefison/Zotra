VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: web build dev check clean

web:
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web
	go build -ldflags "-X main.version=$(VERSION)" -o zotra ./cmd/zotra

dev:
	@echo "Run in two terminals: go run ./cmd/zotra"
	@echo "cd web && pnpm dev"

check: web
	cd web && pnpm lint && pnpm typecheck && pnpm test
	go vet ./...
	go test ./...

clean:
	rm -rf zotra web/dist
