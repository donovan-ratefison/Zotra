// The pure rules of the compare screen: the pair of versions, the
// texts of the selects, the changelog, the impact rows and the URL.
// No React.

import type { Supervision } from "../app/sup-api";
import type { DiffRow } from "./diff";
import type { ProcessDefinition, VersionSummary } from "./types";
import { statusText } from "./version-actions";

// The two versions of the screen: the diff goes from base to other.
export interface ComparePair {
  base: string;
  other: string;
}

// comparePair opens the screen on the open version. The base is the
// asked one, else the parent, else the newest other version.
export function comparePair(
  versions: VersionSummary[],
  openId: string,
  baseId: string | null,
): ComparePair | null {
  const open = versions.find((v) => v.id === openId);
  if (versions.length < 2 || open === undefined) {
    return null;
  }
  const has = (id: string | null) =>
    id !== null && id !== openId && versions.some((v) => v.id === id);
  if (has(baseId)) {
    return { base: baseId!, other: openId };
  }
  if (has(open.parent_id)) {
    return { base: open.parent_id!, other: openId };
  }
  const newest = versions
    .filter((v) => v.id !== openId)
    .reduce((best, v) => (v.number > best.number ? v : best));
  return { base: newest.id, other: openId };
}

// pickPair applies one select change. A pick of the version of the
// other side swaps the sides, so the two sides never hold one version.
export function pickPair(
  pair: ComparePair,
  side: "base" | "other",
  id: string,
  versions: VersionSummary[],
): ComparePair {
  if (!versions.some((v) => v.id === id)) {
    return pair;
  }
  const otherSide = side === "base" ? pair.other : pair.base;
  if (id === otherSide) {
    return swapPair(pair);
  }
  return { ...pair, [side]: id };
}

export function swapPair(pair: ComparePair): ComparePair {
  return { base: pair.other, other: pair.base };
}

export function versionText(v: VersionSummary, newest: number | null): string {
  return `v${v.number} · ${v.label} (${statusText(v, newest)})`;
}

const MARK: Record<DiffRow["kind"], string> = {
  add: "+",
  remove: "-",
  modify: "~",
};

export function changeLines(rows: DiffRow[]): string[] {
  return rows.map((row) => `${MARK[row.kind]} ${row.text}`);
}

// impactRows lists the steps of def that hold open cases, in the
// order of def.
export function impactRows(
  sup: Supervision,
  def: ProcessDefinition,
): { name: string; open: number }[] {
  const open = new Map(sup.nodes.map((n) => [n.node_id, n.open]));
  return def.nodes
    .filter((n) => (open.get(n.id) ?? 0) > 0)
    .map((n) => ({ name: n.name, open: open.get(n.id)! }));
}

export function compareUrl(
  processId: string,
  versionId: string,
  baseId: string,
): string {
  return (
    `/?process=${encodeURIComponent(processId)}` +
    `&version=${encodeURIComponent(versionId)}` +
    `&compare=${encodeURIComponent(baseId)}`
  );
}

// stageText is the text that replaces the body while a version
// query fails or loads, else null.
export function stageText(
  base: { isPending: boolean; error: Error | null },
  other: { isPending: boolean; error: Error | null },
): string | null {
  const error = base.error ?? other.error;
  if (error !== null) {
    return `The versions did not load. ${error.message}`;
  }
  if (base.isPending || other.isPending) {
    return "Loading the versions…";
  }
  return null;
}
