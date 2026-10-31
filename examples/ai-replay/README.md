# AI replay pack

This folder holds recorded answers of the Meta model for the demo. With
`ZOTRA_AI_MODE=replay` and `ZOTRA_AI_CACHE_DIR` set to this folder, the
AI features below work with no API key and at no cost. The Docker
compose file uses this mode by default.

Each file is one answer. Its name is the hash of the request (method,
path and body). The files hold no key.

## What works with no key

1. Import a policy: in the studio, click New, then From policy, and
   open one of these files:
   - `examples/home-loan/policy.pdf`
   - `examples/policies/sme-loan-disbursement.pdf`
   - `examples/policies/deblocage-pret-immobilier.pdf`
2. Change a process with the AI assistant, on a fresh database:
   1. Open the process Home loan, version 1.
   2. Click New draft from this version.
   3. Select no step. Keep Restate first on.
   4. Send, in this order, and accept each change:
      - `Give the step Loan offer a deadline of 12 h.`
      - `Add a step Property valuation before Credit analysis, done by a new role Property expert, with a deadline of 72 h and the required document Valuation report.`
3. Update the policy: on the same draft, open the Documentation menu,
   then click Update the policy.

## What needs a key

Another PDF, another message, another order of the steps above, a scan
read by SAM, the explanation of a failed check and the generation of
test cases. See [Use the live AI with your own Meta key](../../README.md#use-the-live-ai-with-your-own-meta-key).
