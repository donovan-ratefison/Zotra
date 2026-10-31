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

// mergeSupervision merges the answers of several versions into one.
// The counts add up per step and per person, in first-seen order. The
// median of a step is the lower median of the merged case ages, the
// same rule as the server.
export function mergeSupervision(answers: Supervision[]): Supervision {
  const nodes = new Map<string, SupNode>();
  const people = new Map<string, SupPerson>();
  const merged: Supervision = {
    version_id: answers.at(-1)?.version_id ?? "",
    total_open: 0,
    total_late: 0,
    nodes: [],
    people: [],
    cases: [],
  };
  for (const a of answers) {
    merged.total_open += a.total_open;
    merged.total_late += a.total_late;
    merged.cases.push(...a.cases);
    for (const n of a.nodes) {
      const row = nodes.get(n.node_id);
      if (row) {
        row.open += n.open;
        row.late += n.late;
      } else {
        nodes.set(n.node_id, { ...n });
      }
    }
    for (const p of a.people) {
      const row = people.get(p.user_id);
      if (row) {
        row.open += p.open;
        row.late += p.late;
      } else {
        people.set(p.user_id, { ...p });
      }
    }
  }
  for (const row of nodes.values()) {
    const ages = merged.cases
      .filter((c) => c.node_id === row.node_id)
      .map((c) => c.age_hours)
      .sort((x, y) => x - y);
    row.median_hours = ages.length === 0 ? 0 : ages[Math.floor((ages.length - 1) / 2)]!;
  }
  merged.nodes = [...nodes.values()];
  merged.people = [...people.values()];
  return merged;
}

// fetchSupervisionAll reads the supervision of each version and
// merges the answers. One failed read rejects with its ApiError.
export async function fetchSupervisionAll(
  versionIds: string[],
): Promise<Supervision> {
  return mergeSupervision(await Promise.all(versionIds.map(fetchSupervision)));
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
