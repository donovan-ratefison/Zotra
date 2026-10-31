// Mirrors of the contracts this studio reads: the process file
// (plan section 2) and the JSON rows of the API routes.

export type FieldType =
  | "string"
  | "enum"
  | "number"
  | "money"
  | "integer"
  | "boolean"
  | "date"
  | "document";
export type ScopeAccess = "read" | "write" | "hidden";
export type NodeType = "start" | "task" | "gateway" | "end";
export type EndResult = "approved" | "refused";

export interface Theme {
  brand_name: string;
  primary_color: string;
  logo_url: string | null;
}
export interface Role {
  id: string;
  name: string;
  department: string;
}
export interface Field {
  name: string;
  label: string;
  type: FieldType;
  options: string[];
  computed: string | null;
  format?: "percent" | null;
}
export interface ScopeRow {
  field: string;
  role: string;
  access: ScopeAccess;
}
export interface Check {
  id: string;
  expression: string;
  message: string;
  plain_text: string | null;
  citations: string[];
}
export interface ProcessNode {
  id: string;
  type: NodeType;
  name: string;
  role: string | null;
  deadline_hours: number | null;
  documents: string[];
  signature: boolean;
  checks: Check[];
  decisions: string[];
  end_result: EndResult | null;
  scope_overrides: ScopeRow[];
  source_ids: string[];
  citations: string[];
}
export interface ProcessEdge {
  id: string;
  from: string;
  to: string;
  label: string | null;
  decision: string | null;
  condition: string | null;
  is_default: boolean;
}
// An external source of the process: a task lists its id in
// source_ids, and the engine fetches its url at that task.
export interface SourceRow {
  id: string;
  name: string;
  url: string;
  test_values: Record<string, unknown>;
}
export interface ProcessDefinition {
  schema_version: string;
  name: string;
  currency: string;
  policy_document_id: string | null;
  theme: Theme;
  roles: Role[];
  fields: Field[];
  scope: ScopeRow[];
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  sources: SourceRow[];
}

// Rows of the database tables, as the API serves them.
export interface ProcessSummary {
  id: string;
  name: string;
  created_at: string;
  // Absent or null: the process is not archived.
  archived_at?: string | null;
}
export type VersionStatus = "draft" | "frozen" | "published";
export interface VersionSummary {
  id: string;
  process_id: string;
  parent_id: string | null;
  number: number;
  label: string;
  status: VersionStatus;
  created_at: string;
  frozen_at: string | null;
}
export interface Version extends VersionSummary {
  definition: ProcessDefinition;
}

// Envelopes of the GET routes.
export interface ProcessesBody {
  processes: ProcessSummary[];
}
export interface VersionsBody {
  versions: Version[];
}
export interface VersionBody {
  version: Version;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details: unknown[] };
}
