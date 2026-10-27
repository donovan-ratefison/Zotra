#!/usr/bin/env bash
# One PNG of one page of the working tree, at 1366 x 768.
set -euo pipefail

MAIN="$(cd "$(dirname "$0")/.." && pwd)"
URL="${URL:-/}"
OUT="${OUT:-screenshot.png}"
ADDR="127.0.0.1:8091"
DB_URL="${ZOTRA_REVIEW_DATABASE_URL:-postgres://zotra:zotra@127.0.0.1:5434/zotra_review?sslmode=disable}"

cd "$MAIN"
make build VERSION="$(git rev-parse --short HEAD)"

PID=""
cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

ZOTRA_ADDR="$ADDR" ZOTRA_DATABASE_URL="$DB_URL" ./zotra &
PID=$!

up=0
for _ in $(seq 1 60); do
  if curl -fsS "http://$ADDR/api/health" >/dev/null 2>&1; then
    up=1
    break
  fi
  sleep 0.5
done
if [ "$up" != 1 ]; then
  echo "the server did not answer within 30 s" >&2
  exit 1
fi

cd "$MAIN/web"
node scripts/screenshot.mjs "http://$ADDR$URL" "$MAIN/$OUT"
