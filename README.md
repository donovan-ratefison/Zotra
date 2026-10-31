<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/zotra-logo-dark.svg">
    <img src="docs/logo/zotra-logo-light.svg" alt="Zotra, workflow studio for banks" width="420">
  </picture>
</p>

<p align="center">
  <b>From a credit policy PDF to a tested approval app.</b><br>
  The AI drafts and tests. People decide.
</p>

<p align="center">
  <a href="https://github.com/donovan-ratefison/Zotra/actions/workflows/ci.yml"><img src="https://github.com/donovan-ratefison/Zotra/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/donovan-ratefison/Zotra/releases/latest"><img src="https://img.shields.io/github/v/release/donovan-ratefison/Zotra?color=820ad1" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/license-Apache%202.0-820ad1" alt="License: Apache 2.0">
  <img src="https://img.shields.io/badge/Meta%20Global%20AI%20Developer%20Hackathon-2026-820ad1" alt="Meta Global AI Developer Hackathon 2026">
</p>

## Try it in 2 minutes

You need Docker with Compose v2.

```sh
git clone https://github.com/donovan-ratefison/Zotra.git && cd Zotra
docker compose up -d
```

Open http://127.0.0.1:8080. No AI key is needed for the demo: the app
replays recorded AI answers for the example policies. The steps are in
[examples/ai-replay](examples/ai-replay/README.md).

## The problem

A bank writes its credit procedures in PDF policies. To turn one policy into a
workflow, business and IT teams meet for weeks. After that, nobody can easily
say which step comes from which rule of the text.

## How it works

### 1. Read the policy

Drop a PDF. The AI drafts the steps, roles, deadlines, documents and rules.
Each step cites its paragraph. The draft stays in dashed violet until you
accept it. You can also start from scratch and draw the process by hand.

![The AI turns a loan policy into a process draft](docs/images/ai-proposal.png)

### 2. Shape the process

Add, link and delete steps on the diagram, or ask the AI assistant in plain
words. When a request is not clear, the assistant asks you to pick from the
roles and documents of the process. You see each change before it is saved.

![The AI assistant proposes a new step](docs/images/ai-chat.png)

### 3. Test it

Play a case as any role. The diagram shows the path, and the timeline replays
it from any step. When a check fails, ask the AI why. It can also write the
test cases that cover the paths you missed.

![A test case runs on the diagram](docs/images/test-mode.png)

### 4. Ship it

Freeze and publish. Each role gets an app in the bank colors. The triage deck
shows the most urgent case first, with its figures, rules, documents and the
hash chain of its events.

![The triage deck of a credit analyst](docs/images/app-triage.png)

The supervision shows where cases wait, which ones are late, and who decided
what today.

![The live supervision of the process](docs/images/app-supervision.png)

### 5. Keep the policy up to date

The documentation of each version is written as a policy, in the logo and
colors of the bank. After a change, the AI rewrites the policy paragraphs that
the change touches, for the bank to review.

## Built for review, not blind trust

- Every AI answer passes the JSON Schema, the CEL type check and the citation
  check before you see it.
- A click on a citation opens its paragraph in the PDF.
- Nothing from the AI is saved until a person accepts it.

## The AI never decides

On a live case, only CEL rules and people decide. The AI helps to design and to
test the process. Without an AI key, you can still design the process by hand.

## Meta models

| Model | Used for |
|-------|----------|
| Muse Spark 1.3 | Policy to process, process changes, rules, test cases, explanations, policy update |
| SAM 3.1 | Signature, stamp and ID areas on scanned documents |

## Install

### Docker (recommended)

See [Try it in 2 minutes](#try-it-in-2-minutes). To use another port:
`ZOTRA_PORT=9090 docker compose up -d`.

### Release binary

1. Download the archive for your system from the
   [releases page](https://github.com/donovan-ratefison/Zotra/releases) and
   extract it.
2. Start PostgreSQL 16.
3. Set `ZOTRA_DATABASE_URL`, for example
   `postgres://zotra:zotra@127.0.0.1:5432/zotra?sslmode=disable`.
4. Run `./zotra`, then open http://127.0.0.1:8080.

### From the sources

You need Go, Node 22, pnpm 10 and Docker.

```sh
make setup   # dependencies and .env
make db      # PostgreSQL in Docker
make run     # build and start
```

Run `make` to see all the targets. `make demo` fills the database with a demo
history. To use the live AI, set `ZOTRA_AI_API_KEY` in `.env`.

## Stack

One Go binary: `net/http`, cel-go and PostgreSQL. The web app uses React,
Vite, React Flow, Tailwind CSS and shadcn/ui.

## License

Apache License 2.0. See [LICENSE](LICENSE).
