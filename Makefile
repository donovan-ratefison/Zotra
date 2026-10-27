VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)

.PHONY: web build dev serve check clean review-server screenshot

web:
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web
	go build -ldflags "-X main.version=$(VERSION)" -o zotra ./cmd/zotra

dev:
	@echo "Run in two terminals: go run ./cmd/zotra"
	@echo "cd web && pnpm dev"

# serve runs the app on all interfaces, on one free port. Use it to
# test the app from another machine on the same network.
serve: build
	@port=$$(python3 -c 'import socket; s=socket.socket(); s.bind(("0.0.0.0", 0)); print(s.getsockname()[1]); s.close()'); \
	ip=$$(hostname -I 2>/dev/null | cut -d" " -f1); \
	echo "The app listens on 0.0.0.0:$$port"; \
	echo "  this machine:    http://localhost:$$port"; \
	if [ -n "$$ip" ]; then echo "  other machines:  http://$$ip:$$port"; fi; \
	ZOTRA_ADDR="0.0.0.0:$$port" ./zotra

# review-server serves the main branch for review, on port 8090.
review-server:
	scripts/review-server.sh

# screenshot captures one page of the working tree at 1366 x 768.
# Usage: make screenshot URL=/ OUT=file.png
screenshot:
	URL="$(URL)" OUT="$(OUT)" scripts/screenshot.sh

check: web
	cd web && pnpm lint && pnpm typecheck && pnpm test
	go vet ./...
	go test -p 1 -count=1 ./...

clean:
	rm -rf zotra web/dist
