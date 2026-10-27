// Client of the three GET routes the studio shell needs.

import type {
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
