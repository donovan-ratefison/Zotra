// Drag handles for the studio panels. No panel library: a handle
// reports a new size, and the parent keeps it in state.

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

export function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

// The handle is on the top or left edge of the panel that it
// resizes, so up and left grow the panel.
export function keyResize(
  key: string,
  value: number,
  step: number,
  min: number,
  max: number,
): number | null {
  switch (key) {
    case "ArrowUp":
    case "ArrowLeft":
      return clampSize(value + step, min, max);
    case "ArrowDown":
    case "ArrowRight":
      return clampSize(value - step, min, max);
    case "Home":
      return max;
    case "End":
      return min;
    default:
      return null;
  }
}

export function ResizeHandle({
  orientation,
  label,
  value,
  min,
  max,
  step,
  onResize,
  measure,
}: {
  orientation: "horizontal" | "vertical";
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onResize: (value: number) => void;
  measure: (event: PointerEvent | ReactPointerEvent) => number;
}) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cn(
        "group relative z-10 flex shrink-0 touch-none items-center justify-center outline-none",
        horizontal
          ? "-my-[3px] h-[6px] w-full cursor-row-resize"
          : "-mx-[3px] h-full w-[6px] cursor-col-resize",
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          onResize(clampSize(measure(e), min, max));
        }
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onKeyDown={(e: KeyboardEvent) => {
        const next = keyResize(e.key, value, step, min, max);
        if (next !== null) {
          e.preventDefault();
          onResize(next);
        }
      }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "bg-[var(--border)] group-hover:bg-primary group-focus-visible:bg-primary",
          horizontal ? "h-px w-full" : "h-full w-px",
        )}
      />
    </div>
  );
}
