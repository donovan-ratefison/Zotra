// Client of the document routes the test mode needs: the case scan
// list, the upload, the bytes URL and the SAM zones. The shapes
// follow the delivered routes (internal/api/documents.go).

import { ApiError } from "./api";

// DocumentDTO is one scan of the metadata routes. It never holds the
// bytes.
export interface DocumentDTO {
  id: string;
  case_id: string | null;
  name: string;
  mime: string;
  sha256: string;
  created_at: string;
}

// ZoneBox is one zone box in image pixels.
export interface ZoneBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ZoneDTO is one zone of a scan: a label and its box.
export interface ZoneDTO {
  label: string;
  box: ZoneBox;
}

// request sends one request and returns the parsed answer of a
// success status. A failure throws the ApiError of the error body of
// the API: {"error":{"code":...,"message":...,"details":...}}. A body
// that does not parse, or has another shape, falls back to code
// "http" with the status as message.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.ok) {
    return (await res.json()) as T;
  }
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
  throw new ApiError(res.status, code, message, details);
}

// listCaseDocuments reads GET /api/cases/<id>/documents:
// {"documents":[...]}.
export async function listCaseDocuments(
  caseId: string,
): Promise<DocumentDTO[]> {
  return request<{ documents: DocumentDTO[] }>(
    `/api/cases/${encodeURIComponent(caseId)}/documents`,
  ).then((b) => b.documents);
}

// uploadDocument sends POST /api/cases/<id>/documents with one
// multipart field "file" (201 {"document":...}). No Content-Type
// header here: the browser sets the multipart header with its
// boundary, and the File name travels as the part filename.
export async function uploadDocument(
  caseId: string,
  file: File,
): Promise<DocumentDTO> {
  const form = new FormData();
  form.append("file", file);
  return request<{ document: DocumentDTO }>(
    `/api/cases/${encodeURIComponent(caseId)}/documents`,
    { method: "POST", body: form },
  ).then((b) => b.document);
}

// documentBytesUrl gives the URL of the stored bytes of one scan.
export function documentBytesUrl(id: string): string {
  return `/api/documents/${id}/bytes`;
}

// readZones sends POST /api/documents/<id>/zones with an empty JSON
// body and returns the SAM zones ({"zones":[...]}).
export async function readZones(id: string): Promise<ZoneDTO[]> {
  return request<{ zones: ZoneDTO[] }>(
    `/api/documents/${encodeURIComponent(id)}/zones`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  ).then((b) => b.zones);
}
