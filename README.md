# Zotra

From credit policy to a tested, branded approval app in minutes. The AI drafts and tests. Humans decide.

![CI](https://github.com/donovan-ratefison/Zotra/actions/workflows/ci.yml/badge.svg)

## Status

Work in progress for the Meta Global AI Developer Hackathon (October 26 to November 4, 2026).

## What it does

1. **Design.** New offers From a policy or From scratch: a scratch draft starts empty, and the designer adds the steps or asks the assistant. You import a credit policy as a PDF, and the AI drafts the steps, the roles, the data scope and the CEL rules, each with a link to its source paragraph. The import reads the text of the PDF: a scan or a photo with no text gets a clear message, and no AI call. When the text is not a credit policy, the AI says so with a short reason, in place of a proposal. The server keeps the imported PDF with the process, so the Policy panel shows it again after a reload. Every draft passes the JSON Schema, the CEL type check and the citation check before you see it. The proposal then waits for you: added steps draw as dashed ghosts, changed steps show the diff, and a click on a citation chip highlights its paragraph in the PDF. You accept or reject, and the studio edits each step in the side panel. Check rules open a guided builder by default: rows of field, operator and value, joined with and or or, with a preview of the generated CEL. A toggle switches to the raw CEL, and a rule changed there shows a notice with a one-click restore of the guided form. The Screen tab of a step previews the screen of its role in the brand colors and lists the form fields with their access: a drag changes their order. With no step selected, the side panel gives an overview of the process: structure problems, the shortest path to approval with its deadline total, the roles and the data fields. A hover on a role lights its steps; a hover on a step lights its links. The keyboard reaches every step: Tab, the arrow keys and Enter. Each external source of a step, for example a credit blacklist, draws as a small dashed card above the step, joined to it by a dotted link. On a draft, a toolbar on the diagram adds a start, a task, a gateway or an end, a drag from one step to another adds a link, and the side panel removes a link or deletes a step. The side panel also sets the condition of a gateway link and the default link, the decision of a link from a task, and the result of an end. Undo reverts each change. AI assistant: describe a change of the process in plain words, review the proposal on the diagram, accept or reject it. When the request is not clear, the assistant first asks up to three questions, with the usual choice of the bank ticked and its reason. You change the choices or type another answer, then the change uses them. When a step is selected on the diagram, the chat shows "About: <step name>" and reads "this step" or "here" as that step.
2. **Test.** You create a test case, act as any role, and play the circuit step by step: the step screen builds its form from the data scope, you take the step, submit values and decide. The form fits on the screen: two columns, a short summary of the case data, help in tooltips, and the actions always visible at the bottom. The step also carries its documents: you attach one scan per required name, open each scan with the zones detected on it, read its fields into the form with one click, and sign when the step asks for a signature. A missing scan or a missing signature keeps the submit and decision buttons off. The diagram comes alive as the case runs: the taken links light up, the current step pulses with the actor token, and a failed check shakes its step. The timeline under the diagram shows one point per step, the steps still to come in grey, and player controls (start, back, play, forward, present, speed). A click on a past point replays the case from it: the inspector shows each field before and after, and the checks tab carries each result. From the replay bar, you copy the run up to that event into a new test case: you change one submitted value, the copy plays the same commands, and it stops where the engine refuses. When a check fails, you ask the AI why: it explains in plain language and proposes a rule fix, and you apply the fix to the draft or reject it. The coverage view shows the branches no case has taken, and one click asks the AI to write the missing test cases.
3. **Version.** You freeze the draft, publish the frozen version for new cases, and start a new draft from any version. The version badge in the top bar is a selector: it lists every version and opens the one you pick, so you can return to a previous version at any time. The top bar shows the actions the status of the opened version allows, and the Export button downloads the process definition as a JSON file. The History panel shows every version on a vertical line, newest first, with its status, its parent and the actions its status allows. When it opens, the newest published version is in view. The studio home (`/`, also `/processes`) is the process library: it lists every process as cards with a diagram thumbnail, or as a table, with a search, a status filter and a sort; a click opens the process in the studio. Archive hides a process from the library and keeps its data; the Archived filter shows it again, with a Restore button. Each version also has a living documentation, generated from its process file at each request: `/api/versions/<id>/doc.html` is a printable page with the diagram, the steps, the roles, the data scope, the rules and their policy citations, and `/api/versions/<id>/doc.md` is the same text in Markdown. The Documentation button of the top bar opens the page in a new tab or downloads the Markdown file. Its Update the policy item asks the AI for a draft of the policy text for the changes since version 1: each changed paragraph shows the old text struck and the new text highlighted, with a Markdown download. Nothing is stored. The Compare button of a History card opens the compare screen: the diagram marks the added and changed steps, and the right panel lists each difference, the open cases of the base version, and a changelog. The Summarize with AI button asks the AI for a short summary of the changes, in plain words.
4. **Ship.** Each role gets a branded app at `/app`: an inbox of the cases that wait for its roles, a case screen with the step form, its documents and scans, and the brand colors of the process. The first taker owns a case. The triage page (`/app/triage`, key T) shows the queue as a deck of cards, most urgent first, with the key figures, the rules and the documents of each case; F and U send the decisions of the step and stay locked while a rule fails. D or a click on a document row opens the scans of the case, with the zones that the document model finds and what still blocks the step. O opens the case screen of the card for the fields, scans and signature; back returns to the same card, and a send there returns to the next card. Each triage card shows the case history as a strip of blocks, one for each step, with the short hash of its last event; V checks the hash chain and names the first event that changed. Supervision shows four key figures (cases in progress, average lead time, cases late, return rate), the step where the flow blocks, who decided today, a live flow diagram with the open cases, the deadline halo of each step and the moving cases, and the open cases per step with lateness and load per participant, and the audit log lists every event of every case with a one-click hash chain check.

## Meta models

| Model | Tasks |
|-------|-------|
| Muse Spark 1.3 | Policy to process, rules, test cases, explanations, document reading. |
| SAM 3.1 | Signature, stamp and ID areas on scanned documents. |

The case scans can stay in your network: set `ZOTRA_AI_DOC_BASE_URL`, `ZOTRA_AI_DOC_API_KEY` and `ZOTRA_AI_READ_MODEL` to send the zone detection and the field reading to your own endpoint. The design tools keep the text endpoint.

## The AI never decides

Only CEL rules and people decide on a case. A manual mode works without AI.

## Stack

Go (net/http, cel-go, PostgreSQL), React (Vite, React Flow, Tailwind CSS, shadcn/ui). One single binary.

## Run it

You need Go 1.27, Node 22, pnpm, and PostgreSQL 16 (or Docker).

Start a PostgreSQL that matches `.env.example`:

```
docker run -d --name zotra-postgres -e POSTGRES_USER=zotra -e POSTGRES_PASSWORD=zotra -e POSTGRES_DB=zotra -p 5432:5432 postgres:16
```

With your own PostgreSQL, set `ZOTRA_DATABASE_URL` in `.env`.

Build and start the server:

```
cp .env.example .env
make build
set -a; . ./.env; set +a
./zotra
```

The server reads its settings from the environment. The third line loads `.env` into the shell.
The first start creates the tables and the example process.

The app runs at http://localhost:8080.

With no `ZOTRA_AI_API_KEY`, the AI buttons answer that the AI is not available (`ai: no API key`). The manual mode works.

Before a real case of the example reaches the analysis step, start the demo core banking service on port 8097: `go run ./cmd/zotra-demo`.

To test from another machine on the same network, run `make serve`.
It binds 0.0.0.0, picks a free port, and prints the URL.

## License

Apache License 2.0. See [LICENSE](LICENSE).
