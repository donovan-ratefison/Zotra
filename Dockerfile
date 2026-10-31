# Build the web app.
FROM node:22 AS web
RUN npm install -g pnpm@10.33.0
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
# tsc also checks the tests, and the tests import these two files.
COPY examples/home-loan/process.json /src/examples/home-loan/
COPY internal/store/seed/example-process.json /src/internal/store/seed/
RUN pnpm build

# Build the three binaries. The web app is embedded in zotra.
FROM golang:1.27.3 AS go
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web web
COPY --from=web /src/web/dist web/dist
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION}" -o /out/ ./cmd/zotra ./cmd/zotra-history ./cmd/zotra-demo

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=go /out/ /app/
COPY examples /app/examples
EXPOSE 8080
ENTRYPOINT ["/app/zotra"]
