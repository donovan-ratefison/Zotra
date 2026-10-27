#!/usr/bin/env bash
# Review server: build and serve the main branch on port 8090.
set -euo pipefail

MAIN="$(cd "$(dirname "$0")/.." && pwd)"
WORKTREE="$MAIN/../Zotra-review"
ADDR="${ZOTRA_ADDR:-0.0.0.0:8090}"
DB_URL="${ZOTRA_REVIEW_DATABASE_URL:-postgres://zotra:zotra@127.0.0.1:5434/zotra_review?sslmode=disable}"
LOG="$MAIN/local/review-server.log"
PID=""

cleanup() {
  if [ -n "$PID" ]; then
    kill "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT
# INT and TERM must end the poll loop at any phase, also during a
# build. The exit runs the EXIT trap, which stops the server.
trap 'exit 130' INT
trap 'exit 143' TERM

# The database zotra_review, once.
if ! docker exec zotra-db psql -U zotra -lqt | cut -d '|' -f 1 | grep -qw zotra_review; then
  docker exec zotra-db createdb -U zotra zotra_review
fi

# The feedback folder.
mkdir -p "$MAIN/local/feedback"

# The worktree, once.
if [ ! -e "$WORKTREE/.git" ]; then
  git -C "$MAIN" worktree add --detach "$WORKTREE"
fi

last=""
while true; do
  sha="$(git -C "$MAIN" rev-parse main)"
  if [ "$sha" != "$last" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') build $sha" | tee -a "$LOG"
    if git -C "$WORKTREE" checkout --detach -q "$sha" \
       && (cd "$WORKTREE" && make build VERSION="$sha" >>"$LOG" 2>&1); then
      if [ -n "$PID" ]; then
        kill "$PID" 2>/dev/null || true
        while kill -0 "$PID" 2>/dev/null; do sleep 0.1; done
      fi
      ( cd "$WORKTREE" \
        && exec env ZOTRA_ADDR="$ADDR" ZOTRA_DATABASE_URL="$DB_URL" \
           ZOTRA_FEEDBACK_DIR="$MAIN/local/feedback" \
           ./zotra >>"$LOG" 2>&1 ) &
      PID=$!
      echo "$PID" >"$WORKTREE/.server.pid"
      last="$sha"
    else
      echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') build failed, the old server stays up" | tee -a "$LOG"
    fi
  fi
  sleep 30
done
