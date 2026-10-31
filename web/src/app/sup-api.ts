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
  returned: boolean;
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

export interface FlowEnd {
  node_id: string;
  cases: number;
  avg_lead_hours: number;
}

export interface FlowPass {
  edge_id: string;
  passes: number;
}

export interface Flow {
  days: number;
  closed: number;
  ends: FlowEnd[];
  edges: FlowPass[];
  returns: number;
  today: { people: number; rules: number };
}

// fetchFlow reads GET /api/versions/<id>/flow?days=<days>: the closed
// cases per end, the passes per edge, the returns and the work of
// today.
export async function fetchFlow(versionId: string, days = 30): Promise<Flow> {
  const res = await fetch(`/api/versions/${versionId}/flow?days=${days}`);
  if (res.ok) {
    return (await res.json()) as Flow;
  }
  throw await apiError(res);
}

// weightedLead gives the mean lead time of end rows, weighted by their
// cases, to one decimal. It gives 0 when the rows hold no case.
export function weightedLead(rows: FlowEnd[]): number {
  const cases = rows.reduce((sum, row) => sum + row.cases, 0);
  if (cases === 0) {
    return 0;
  }
  const hours = rows.reduce((sum, row) => sum + row.avg_lead_hours * row.cases, 0);
  return Math.round((hours / cases) * 10) / 10;
}

// mergeFlow merges the flow answers of several versions into one. The
// counts add up per end and per edge, in first-seen order.
export function mergeFlow(answers: Flow[]): Flow {
  const ends = new Map<string, FlowEnd[]>();
  const edges = new Map<string, FlowPass>();
  const merged: Flow = {
    days: answers[0]?.days ?? 30,
    closed: 0,
    ends: [],
    edges: [],
    returns: 0,
    today: { people: 0, rules: 0 },
  };
  for (const a of answers) {
    merged.closed += a.closed;
    merged.returns += a.returns;
    merged.today.people += a.today.people;
    merged.today.rules += a.today.rules;
    for (const end of a.ends) {
      ends.set(end.node_id, [...(ends.get(end.node_id) ?? []), end]);
    }
    for (const edge of a.edges) {
      const row = edges.get(edge.edge_id);
      if (row) {
        row.passes += edge.passes;
      } else {
        edges.set(edge.edge_id, { ...edge });
      }
    }
  }
  merged.ends = [...ends].map(([nodeId, rows]) => ({
    node_id: nodeId,
    cases: rows.reduce((sum, row) => sum + row.cases, 0),
    avg_lead_hours: weightedLead(rows),
  }));
  merged.edges = [...edges.values()];
  return merged;
}

// fetchFlowAll reads the flow of each version and merges the answers.
// One failed read rejects with its ApiError.
export async function fetchFlowAll(
  versionIds: string[],
  days = 30,
): Promise<Flow> {
  return mergeFlow(await Promise.all(versionIds.map((id) => fetchFlow(id, days))));
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
