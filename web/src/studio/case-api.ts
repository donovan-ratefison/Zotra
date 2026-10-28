// Client of the case routes the test mode needs: the users list,
// the case create and read, the event list, and the commands. The
// shapes follow the delivered code of lot 1.5 (internal/api/cases.go).

import { ApiError } from "./api";

export interface UserDTO {
  id: string;
  name: string;
  role_ids: string[];
}
export interface CaseDTO {
  id: string;
  version_id: string;
  reference: string;
  is_test: boolean;
  created_at: string;
}
export type CaseState = {
  case_id: string;
  version_id: string;
  status: "open" | "closed";
  result: string;
  node_id: string;
  data: Record<string, unknown>;
  assignee: string;
  seq: number;
  prev_hash: string;
};
export interface CaseEvent {
  case_id: string;
  seq: number;
  type: string;
  at: string;
  actor: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}
export interface CommandInput {
  type: "start" | "take" | "submit" | "decide";
  data?: Record<string, unknown>;
  values?: Record<string, unknown>;
  decision?: string;
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

// getJson reads one GET route and returns the parsed answer.
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.ok) {
    return (await res.json()) as T;
  }
  throw await apiError(res);
}

// postJson sends one JSON request and returns the parsed answer.
// With userId, it carries the X-Zotra-User header.
async function postJson<T>(
  path: string,
  body: unknown,
  userId?: string,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId === undefined ? {} : { "X-Zotra-User": userId }),
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    return (await res.json()) as T;
  }
  throw await apiError(res);
}

// listUsers reads GET /api/users: {"users":[...]}.
export async function listUsers(): Promise<UserDTO[]> {
  return getJson<{ users: UserDTO[] }>("/api/users").then((b) => b.users);
}

// createCase sends POST /api/cases and returns the created case
// (201 {"case":...}). The data enters through the start command.
export async function createCase(
  versionId: string,
  isTest: boolean,
): Promise<CaseDTO> {
  return postJson<{ case: CaseDTO }>(
    "/api/cases",
    { version_id: versionId, is_test: isTest },
  ).then((b) => b.case);
}

// readCase reads GET /api/cases/<id>: {"case":...,"state":...}.
// With at, the state folds the first at events only.
export async function readCase(
  caseId: string,
  at?: number,
): Promise<{ case: CaseDTO; state: CaseState }> {
  const query = at === undefined ? "" : `?at=${at}`;
  return getJson<{ case: CaseDTO; state: CaseState }>(
    `/api/cases/${encodeURIComponent(caseId)}${query}`,
  );
}

// listEvents reads GET /api/cases/<id>/events: {"events":[...]} in
// seq order.
export async function listEvents(caseId: string): Promise<CaseEvent[]> {
  return getJson<{ events: CaseEvent[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/events`,
  ).then((b) => b.events);
}

// runCommand sends POST /api/cases/<id>/commands with the
// X-Zotra-User header and the five body fields, empty when unused
// (document_hash stays empty: Sign comes with lot 5.2). The answer
// is {"events":...,"state":...}.
export async function runCommand(
  caseId: string,
  userId: string,
  cmd: CommandInput,
): Promise<{ events: CaseEvent[]; state: CaseState }> {
  return postJson(
    `/api/cases/${encodeURIComponent(caseId)}/commands`,
    {
      type: cmd.type,
      data: cmd.data ?? {},
      values: cmd.values ?? {},
      decision: cmd.decision ?? "",
      document_hash: "",
    },
    userId,
  );
}
