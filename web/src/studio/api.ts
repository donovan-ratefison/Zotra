// Client of the GET routes the studio shell needs, the PUT route of
// the node panel, and the create and AI routes of the policy import.

import type {
  ProcessDefinition,
  ProcessSummary,
  ProcessesBody,
  Version,
  VersionBody,
  VersionsBody,
} from "./types";
import type { Paragraph } from "./policy";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown[] = [],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
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

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (res.ok) {
    return (await res.json()) as T;
  }
  throw await apiError(res);
}

// postJson sends one POST request and returns the parsed answer of
// a success status. The init carries a body only when the caller
// gives one: the lifecycle routes read no body on freeze and
// publish. A failure throws the ApiError of the error body.
async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.ok) {
    return (await res.json()) as T;
  }
  throw await apiError(res);
}

// requestJson sends one JSON request and returns the parsed answer
// of a success status. A failure throws the ApiError of the error
// body. A given signal lets the caller abort the request.
async function requestJson<T>(
  path: string,
  method: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (res.ok) {
    return (await res.json()) as T;
  }
  throw await apiError(res);
}

export async function listProcesses(): Promise<ProcessSummary[]> {
  const body = await getJson<ProcessesBody>("/api/processes");
  return body.processes;
}

export async function listVersions(processId: string): Promise<Version[]> {
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
  return requestJson<VersionBody>(
    `/api/versions/${encodeURIComponent(versionId)}`,
    "PUT",
    { definition },
  ).then((body) => body.version);
}

// policyToProcess sends the numbered paragraphs of one policy to the
// AI and returns the proposed document with the attempt count.
export async function policyToProcess(
  name: string,
  paragraphs: Paragraph[],
  signal?: AbortSignal,
): Promise<{ definition: ProcessDefinition; attempts: number }> {
  return requestJson<{ definition: ProcessDefinition; attempts: number }>(
    "/api/ai/policy-to-process",
    "POST",
    { name, paragraphs },
    signal,
  );
}

// createProcess creates one process and returns its summary.
export async function createProcess(name: string): Promise<ProcessSummary> {
  return requestJson<{ process: ProcessSummary }>("/api/processes", "POST", {
    name,
  }).then((body) => body.process);
}

// archiveProcess hides one process from the library. Its versions and
// cases stay. An unknown id gives 404 "not_found".
export async function archiveProcess(id: string): Promise<ProcessSummary> {
  return postJson<{ process: ProcessSummary }>(
    `/api/processes/${encodeURIComponent(id)}/archive`,
  ).then((body) => body.process);
}

// restoreProcess brings one archived process back to the library.
export async function restoreProcess(id: string): Promise<ProcessSummary> {
  return postJson<{ process: ProcessSummary }>(
    `/api/processes/${encodeURIComponent(id)}/restore`,
  ).then((body) => body.process);
}

// createVersion creates one draft version of a process.
export async function createVersion(
  processId: string,
  label: string,
  definition: ProcessDefinition,
): Promise<Version> {
  return requestJson<{ version: Version }>(
    `/api/processes/${encodeURIComponent(processId)}/versions`,
    "POST",
    { label, definition },
  ).then((body) => body.version);
}

// freezeVersion moves a draft to frozen. A non-draft gives 409
// "conflict".
export async function freezeVersion(versionId: string): Promise<Version> {
  return postJson<VersionBody>(
    `/api/versions/${encodeURIComponent(versionId)}/freeze`,
  ).then((body) => body.version);
}

// publishVersion moves a frozen version to published. A non-frozen
// version gives 409 "conflict".
export async function publishVersion(versionId: string): Promise<Version> {
  return postJson<VersionBody>(
    `/api/versions/${encodeURIComponent(versionId)}/publish`,
  ).then((body) => body.version);
}

// forkVersion starts a draft from a version of any status, with the
// label given. The answer carries the new draft, with the next
// number and the parent set.
export async function forkVersion(
  versionId: string,
  label: string,
): Promise<Version> {
  return postJson<VersionBody>(
    `/api/versions/${encodeURIComponent(versionId)}/fork`,
    { label },
  ).then((body) => body.version);
}

// uploadPolicy stores the policy PDF of a process. A new upload
// replaces the old file. The header carries the escaped file name.
export async function uploadPolicy(processId: string, file: File): Promise<void> {
  const res = await fetch(
    `/api/processes/${encodeURIComponent(processId)}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  if (!res.ok) {
    throw await apiError(res);
  }
}

// fetchPolicy reads the stored policy PDF of a process. No stored
// file (404) gives null. A bad escape in the name header keeps the
// raw value; no header gives "policy.pdf".
export async function fetchPolicy(processId: string): Promise<File | null> {
  const res = await fetch(
    `/api/processes/${encodeURIComponent(processId)}/policy`,
  );
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw await apiError(res);
  }
  const raw = res.headers.get("X-File-Name");
  let name = "policy.pdf";
  if (raw !== null) {
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
  }
  return new File([await res.blob()], name, { type: "application/pdf" });
}
