// Client of the inbox route the delivered app needs. The shapes
// follow the delivered code (internal/api/inbox.go: the user row
// plus the open cases that wait for a role of the user).

import { ApiError } from "../studio/api";

export interface InboxUser {
  id: string;
  name: string;
  role_ids: string[];
}
export interface InboxCase {
  id: string;
  version_id: string;
  reference: string;
  is_test: boolean;
  created_at: string;
  node_id: string;
  status: string;
}

// apiError builds the ApiError of one failed response, from the error
// body of the API: {"error":{"code":...,"message":...,"details":...}}.
// A body that does not parse, or has another shape, falls back to code
// "http" with the status as message. The rule repeats the one of
// case-api.ts; the helper itself is not shared.
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

// fetchInbox reads GET /api/inbox for one demo user: the user row
// plus the open cases of the roles of the user. The header carries
// the user id.
export async function fetchInbox(
  userId: string,
): Promise<{ user: InboxUser; cases: InboxCase[] }> {
  const res = await fetch("/api/inbox", {
    headers: { "X-Zotra-User": userId },
  });
  if (res.ok) {
    return (await res.json()) as { user: InboxUser; cases: InboxCase[] };
  }
  throw await apiError(res);
}
