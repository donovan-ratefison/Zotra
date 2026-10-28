# Zotra

From credit policy to a tested, branded approval app in minutes. The AI drafts and tests. Humans decide.

![CI](https://github.com/donovan-ratefison/Zotra/actions/workflows/ci.yml/badge.svg)

## Status

Work in progress for the Meta Global AI Developer Hackathon (October 26 to November 4, 2026).

## What it does

1. **Design.** You import a credit policy as a PDF, and the AI drafts the steps, the roles, the data scope and the CEL rules, each with a link to its source paragraph. Every draft passes the JSON Schema, the CEL type check and the citation check before you see it. The proposal then waits for you: added steps draw as dashed ghosts, changed steps show the diff, and a click on a citation chip highlights its paragraph in the PDF. You accept or reject, and the studio edits each step in the side panel. With no step selected, the side panel gives an overview of the process: structure problems, the shortest path to approval with its deadline total, the roles and the data fields. A hover on a role lights its steps; a hover on a step lights its links. The keyboard reaches every step: Tab, the arrow keys and Enter.
2. **Test.** You create a test case, act as any role, and play the circuit step by step: the step screen builds its form from the data scope, you take the step, submit values and decide. The diagram comes alive as the case runs: the taken links light up, the current step pulses with the actor token, and a failed check shakes its step. The timeline replays any past event: the inspector shows each field before and after, and the checks tab carries each result. When a check fails, you ask the AI why: it explains in plain language and proposes a rule fix, and you apply the fix to the draft or reject it. The coverage view shows the branches no case has taken, and one click asks the AI to write the missing test cases.
3. **Version.** You freeze a version, compare two versions, and start a new draft from an old one.
4. **Ship.** Each role gets a branded app with an inbox, a step screen, supervision, and a tamper-evident audit log.

## Meta models

| Model | Tasks |
|-------|-------|
| Muse Spark 1.3 | Policy to process, rules, test cases, explanations, document reading. |
| SAM 3.1 | Signature, stamp and ID areas on scanned documents. |

## The AI never decides

Only CEL rules and people decide on a case. A manual mode works without AI.

## Stack

Go (net/http, cel-go, PostgreSQL), React (Vite, React Flow, Tailwind CSS, shadcn/ui). One single binary.

## Run it

You need Go 1.27, Node 22 and pnpm.

```
cp .env.example .env
make build
./zotra
```

The app runs at http://localhost:8080.

To test from another machine on the same network, run `make serve`.
It binds 0.0.0.0, picks a free port, and prints the URL.

## License

Apache License 2.0. See [LICENSE](LICENSE).
