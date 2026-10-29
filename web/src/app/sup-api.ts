// Client of the supervision and audit routes the delivered app
// needs. The shapes follow the delivered code (internal/api/
// supervision.go and internal/api/audit.go).

import { ApiError } from "../studio/api";

// apiError builds the ApiError of one failed response, from the error
// body of the API: {"error":{"code":...,"message":...,"details":...}}.
// A body that does not parse, or has another shape, falls back to code
// "http" with the status as message. The rule repeats the one of
// app-api.ts; the helper itself is not shared.
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

export interface SupNode {
  node_id: string;
  open: number;
  late: number;
  median_hours: number;
}

export interface SupPerson {
  user_id: string;
  open: number;
  late: number;
}

export interface SupCase {
  case_id: string;
  reference: string;
  node_id: string;
  assignee: string;
  age_hours: number;
  late: boolean;
  data: Record<string, unknown>;
}

export interface Supervision {
  version_id: string;
  total_open: number;
  total_late: number;
  nodes: SupNode[];
  people: SupPerson[];
  cases: SupCase[];
}

// fetchSupervision reads GET /api/versions/<id>/supervision: the open
// cases of a version per step, with the counts and the load.
export async function fetchSupervision(
  versionId: string,
): Promise<Supervision> {
  const res = await fetch(`/api/versions/${versionId}/supervision`);
  if (res.ok) {
    return (await res.json()) as Supervision;
  }
  throw await apiError(res);
}

export interface AuditEvent {
  case_id: string;
  seq: number;
  type: string;
  at: string;
  actor: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  reference: string;
}

// fetchAudit reads GET /api/audit?limit=<limit>: the newest events of
// every case, with the count of all events.
export async function fetchAudit(
  limit: number,
): Promise<{ events: AuditEvent[]; total: number }> {
  const res = await fetch(`/api/audit?limit=${limit}`);
  if (res.ok) {
    return (await res.json()) as { events: AuditEvent[]; total: number };
  }
  throw await apiError(res);
}

export interface AuditVerify {
  cases: number;
  events: number;
  broken: { case_id: string; seq: number }[];
}

// fetchAuditVerify reads GET /api/audit/verify: the hash chain check
// of every case.
export async function fetchAuditVerify(): Promise<AuditVerify> {
  const res = await fetch("/api/audit/verify");
  if (res.ok) {
    return (await res.json()) as AuditVerify;
  }
  throw await apiError(res);
}
