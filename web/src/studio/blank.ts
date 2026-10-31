// blankDefinition is the empty draft of a process made from scratch:
// no step, no role, no field. The designer adds the steps by hand,
// or asks the assistant.

import type { ProcessDefinition } from "./types";

export function blankDefinition(name: string): ProcessDefinition {
  return {
    schema_version: "1",
    name,
    currency: "EUR",
    policy_document_id: null,
    theme: { brand_name: name, primary_color: "#820ad1", logo_url: null },
    roles: [],
    fields: [],
    scope: [],
    nodes: [],
    edges: [],
    sources: [],
  };
}
