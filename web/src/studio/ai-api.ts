// Client of POST /api/ai/explain-check: the explanation of one
// failed check and the proposed rule fix. The shapes follow the
// delivered route of lot 3.5 (internal/api/ai.go).

import { ApiError } from "./api";
import type { ProcessDefinition } from "./types";

export interface ExplainProposal {
  expression: string;
  message: string;
  plain_text: string;
}
export interface ExplainAnswer {
  explanation: string;
  proposal: ExplainProposal;
}

// apiError builds the ApiError of one failed response, from the error
// body of the API: {"error":{"code":...,"message":...,"details":...}}.
// A body that does not parse, or has another shape, falls back to code
// "http" with the status as message.
async function apiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const err = (body as { error?: Record<string, unknown> } | null)?.error;
  const code = typeof err?.code === "string" ? err.code : "http";
  const message =
    typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
  const details = Array.isArray(err?.details) ? err.details : [];
  return new ApiError(res.status, code, message, details);
}

// explainCheck asks the AI why one check of the case failed and what
// rule change would fix it. The caller decides whether to apply the
// proposal.
export async function explainCheck(
  caseId: string,
  nodeId: string,
  checkId: string,
): Promise<ExplainAnswer> {
  const res = await fetch("/api/ai/explain-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      case_id: caseId,
      node_id: nodeId,
      check_id: checkId,
    }),
  });
  if (!res.ok) {
    throw await apiError(res);
  }
  return (await res.json()) as ExplainAnswer;
}

// GeneratedCase is one entry of the created list of the
// generate-tests answer.
export interface GeneratedCase {
  case_id: string;
  reference: string;
  target_edge: string;
}
// GenerateTestsAnswer is the answer of POST /api/ai/generate-tests:
// the red edges, the cases the engine kept, and the drops.
export interface GenerateTestsAnswer {
  version_id: string;
  red_edges: string[];
  created: GeneratedCase[];
  errors: string[];
}

// generateTests asks the AI for one test case per red edge of one
// version. The engine runs each proposed case; only the cases that
// reach their edge come back in created.
export async function generateTests(
  versionId: string,
): Promise<GenerateTestsAnswer> {
  const res = await fetch("/api/ai/generate-tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version_id: versionId }),
  });
  if (!res.ok) {
    throw await apiError(res);
  }
  return (await res.json()) as GenerateTestsAnswer;
}

// ChangeAnswer is the answer of POST /api/ai/change-process: the
// proposed definition and the attempt count. Nothing is saved: the
// caller shows the proposal, and the designer accepts or rejects it.
export interface ChangeAnswer {
  definition: ProcessDefinition;
  attempts: number;
}

// changeProcess asks the AI for one changed process file from one
// plain request of the designer. The server validates the answer and
// checks its citations against the current definition.
export async function changeProcess(
  versionId: string,
  message: string,
): Promise<ChangeAnswer> {
  const res = await fetch("/api/ai/change-process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version_id: versionId, message }),
  });
  if (!res.ok) {
    throw await apiError(res);
  }
  return (await res.json()) as ChangeAnswer;
}
