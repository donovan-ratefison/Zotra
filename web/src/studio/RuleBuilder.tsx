// The guided editor of one check: rows of field, operator and value
// with one join, and a read-only preview of the generated CEL. The
// raw CEL stays one toggle away in the expert mode. A rule that left
// the guided rows in this edit session shows a notice, with a restore
// button. A stored rule that the builder reads opens in the guided
// mode with its rows; another stored rule opens in the expert mode.

import { Fragment, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Textarea } from "@/ui/textarea";
import {
  buildExpression,
  defaultRow,
  defaultRowFor,
  initialRuleMode,
  operatorLabel,
  operatorsFor,
  readExpression,
  ruleNotice,
  typesOf,
  type RuleRow,
} from "./rule-builder";
import type { Check, ProcessDefinition } from "./types";

const SELECT_CLASS =
  "h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function RuleBuilder({
  def,
  check,
  onExpressionChange,
  disabled,
}: {
  def: ProcessDefinition;
  check: Check;
  onExpressionChange: (expression: string) => void;
  disabled: boolean;
}) {
  // The stored rule is read once, at mount. A read rule builds the same
  // CEL again, so the mount writes nothing to the draft.
  const [mode, setMode] = useState<"guided" | "expert">(() =>
    initialRuleMode(check.expression, typesOf(def)),
  );
  const [rows, setRows] = useState<RuleRow[]>(
    () => readExpression(check.expression, typesOf(def))?.rows ?? [],
  );
  const [join, setJoin] = useState<"and" | "or">(
    () => readExpression(check.expression, typesOf(def))?.join ?? "and",
  );

  // "" and "true" carry no rule: addCheck starts a check at "true".
  const isMarker = check.expression === "" || check.expression === "true";
  const types = typesOf(def);
  const shownRows = rows.length === 0 && isMarker ? [defaultRow(def)] : rows;
  const guidedExpression = buildExpression(shownRows, types, join);
  // A guided form existed in this edit session when the builder holds
  // rows: only then can the stored CEL have left it.
  const showNotice = ruleNotice(rows.length, check.expression, guidedExpression);

  // One effect covers every marker moment: the stored check and the
  // preview agree in the running app. The props exist at mount, so the
  // first run covers the marker. The guard makes each extra run a
  // no-op, and a read-only panel writes nothing.
  useEffect(() => {
    if (rows.length !== 0 || disabled) return;
    if (check.expression !== "" && check.expression !== "true") return;
    const row = defaultRow(def);
    // The seed keeps the rows editable after the first paint, next to
    // the write to the external draft store. The guard makes each
    // extra run a no-op, so no cascade follows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows([row]);
    onExpressionChange(buildExpression([row], typesOf(def), join));
  }, [rows, check.expression, disabled, def, join, onExpressionChange]);

  const updateRows = (nextRows: RuleRow[]) => {
    setRows(nextRows);
    onExpressionChange(buildExpression(nextRows, types, join));
  };

  const updateJoin = (nextJoin: "and" | "or") => {
    setJoin(nextJoin);
    onExpressionChange(buildExpression(rows, types, nextJoin));
  };

  // The restore path seeds the rows and writes the built expression at
  // once, so it never leaves the marker in the store.
  const restore = () => {
    const row = defaultRow(def);
    setRows([row]);
    onExpressionChange(buildExpression([row], typesOf(def), join));
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        role="group"
        aria-label={`Rule mode of check ${check.id}`}
        className="flex gap-1"
      >
        <Button
          type="button"
          size="sm"
          variant={mode === "guided" ? "secondary" : "ghost"}
          aria-pressed={mode === "guided"}
          disabled={disabled}
          onClick={() => setMode("guided")}
        >
          Guided
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "expert" ? "secondary" : "ghost"}
          aria-pressed={mode === "expert"}
          disabled={disabled}
          onClick={() => setMode("expert")}
        >
          Expert
        </Button>
      </div>
      {mode === "expert" ? (
        <>
          {check.plain_text !== null && check.plain_text !== "" && (
            <p className="text-xs text-muted-foreground">{check.plain_text}</p>
          )}
          <Textarea
            aria-label={`Expression of check ${check.id}`}
            rows={2}
            disabled={disabled}
            className="font-mono text-xs"
            value={check.expression}
            onChange={(e) => onExpressionChange(e.target.value)}
          />
        </>
      ) : showNotice ? (
        <div className="flex flex-col items-start gap-2 rounded-md border p-2.5">
          <span className="text-[12.5px]">
            {
              "This rule was changed in the expert mode. The guided builder cannot show it."
            }
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={restore}
          >
            Restore the guided rule
          </Button>
        </div>
      ) : (
        <>
          {shownRows.map((row, index) => (
            <Fragment key={index}>
              {index > 0 && (
                <div
                  role="group"
                  aria-label="Join of the conditions"
                  className="flex gap-1"
                >
                  <Button
                    type="button"
                    size="xs"
                    variant={join === "and" ? "secondary" : "ghost"}
                    aria-pressed={join === "and"}
                    disabled={disabled}
                    onClick={() => updateJoin("and")}
                  >
                    and
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant={join === "or" ? "secondary" : "ghost"}
                    aria-pressed={join === "or"}
                    disabled={disabled}
                    onClick={() => updateJoin("or")}
                  >
                    or
                  </Button>
                </div>
              )}
              <div
                aria-label={`Condition ${index + 1}`}
                className="flex flex-col gap-1.5 rounded-md border p-2"
              >
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`Field of condition ${index + 1}`}
                    value={row.field}
                    disabled={disabled}
                    className={SELECT_CLASS}
                    onChange={(e) => {
                      const field = def.fields.find(
                        (f) => f.name === e.target.value,
                      );
                      if (field) {
                        updateRows(
                          rows.map((r, i) =>
                            i === index ? defaultRowFor(field) : r,
                          ),
                        );
                      }
                    }}
                  >
                    {def.fields.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove condition ${index + 1}`}
                    disabled={disabled || shownRows.length === 1}
                    onClick={() =>
                      updateRows(rows.filter((_, i) => i !== index))
                    }
                  >
                    <X />
                  </Button>
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={`Operator of condition ${index + 1}`}
                    value={row.op}
                    disabled={disabled}
                    className={SELECT_CLASS}
                    onChange={(e) =>
                      updateRows(
                        rows.map((r, i) =>
                          i === index
                            ? { ...r, op: e.target.value as RuleRow["op"] }
                            : r,
                        ),
                      )
                    }
                  >
                    {operatorsFor(types[row.field] ?? "string").map((op) => (
                      <option key={op} value={op}>
                        {operatorLabel(op)}
                      </option>
                    ))}
                  </select>
                  {row.op !== "notempty" && (
                    <Input
                      aria-label={`Value of condition ${index + 1}`}
                      value={row.value}
                      disabled={disabled}
                      className="h-7 min-w-0 flex-1 text-xs"
                      onChange={(e) =>
                        updateRows(
                          rows.map((r, i) =>
                            i === index ? { ...r, value: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              </div>
            </Fragment>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={disabled}
            onClick={() => updateRows([...rows, defaultRow(def)])}
          >
            Add a condition
          </Button>
          <div className="rounded-md border p-2.5">
            <span className="text-xs text-muted-foreground">
              Generated CEL (read only)
            </span>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-xs">
              {guidedExpression}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
