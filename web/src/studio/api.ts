// Client of the three GET routes the studio shell needs, plus the
// PUT route of the node panel.

import type {
  ProcessDefinition,
  ProcessSummary,
  ProcessesBody,
  Version,
  VersionBody,
  VersionSummary,
  VersionsBody,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.ok) {
    return (await res.json()) as T;
  }
  // Error body of the API: {"error":{"code":...,"message":...}}. A
  // body that does not parse, or has another shape, falls back to
  // code "http" with the status as message.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const err = (body as { error?: { code?: unknown; message?: unknown } } | null)
    ?.error;
  const code = typeof err?.code === "string" ? err.code : "http";
  const message =
    typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
  throw new ApiError(res.status, code, message);
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  const body = await getJson<ProcessesBody>("/api/processes");
  return body.processes;
}

export async function listVersions(processId: string): Promise<VersionSummary[]> {
  const body = await getJson<VersionsBody>(
    `/api/processes/${encodeURIComponent(processId)}/versions`,
  );
  return body.versions;
}

export async function getVersion(versionId: string): Promise<Version> {
  const body = await getJson<VersionBody>(
    `/api/versions/${encodeURIComponent(versionId)}`,
  );
  return body.version;
}

// PUT /api/versions/<versionId>: replaces the definition of a draft.
// A non-draft gives 409 "conflict". The answer carries the stored
// version, so the bytes come back from the database.
export async function updateDraft(
  versionId: string,
  definition: ProcessDefinition,
): Promise<Version> {
  const res = await fetch(`/api/versions/${encodeURIComponent(versionId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ definition }),
  });
  if (res.ok) {
    return ((await res.json()) as VersionBody).version;
  }
  // Same error body rules as getJson above.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const err = (body as { error?: { code?: unknown; message?: unknown } } | null)
    ?.error;
  const code = typeof err?.code === "string" ? err.code : "http";
  const message =
    typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
  throw new ApiError(res.status, code, message);
}
