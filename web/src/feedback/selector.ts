// The CSS selector of a reported element.

// One step of the DOM walk, from the picked element up.
export type SelectorStep = {
  tag: string; // lower-case tag name
  id: string | null; // element id, or null
  testId: string | null; // data-testid value, or null
  nth: number; // 1-based place among same-tag siblings
};

// buildSelector joins the steps, deepest first, with " > ". A step
// with a testId renders `[data-testid="x"]` and ends the selector. A
// step with an id renders `#x` and ends it. Any other step renders
// its tag, plus `:nth-of-type(n)` only when n is more than 1. At most
// 5 steps are kept. An empty input gives "".
export function buildSelector(steps: SelectorStep[]): string {
  const parts: string[] = [];
  for (const step of steps) {
    if (step.testId !== null) {
      parts.push(`[data-testid="${step.testId}"]`);
      break;
    }
    if (step.id !== null) {
      parts.push(`#${step.id}`);
      break;
    }
    parts.push(step.nth > 1 ? `${step.tag}:nth-of-type(${step.nth})` : step.tag);
    if (parts.length === 5) break;
  }
  return parts.join(" > ");
}

// stepsFor walks from el up, one SelectorStep per element, until
// document.documentElement, and returns at most 8 steps, deepest
// first.
export function stepsFor(el: HTMLElement): SelectorStep[] {
  const steps: SelectorStep[] = [];
  for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
    let nth = 1;
    const parent: HTMLElement | null = node.parentElement;
    if (parent !== null) {
      let place = 0;
      for (const child of Array.from(parent.children)) {
        if (child.tagName !== node.tagName) continue;
        place++;
        if (child === node) {
          nth = place;
          break;
        }
      }
    }
    steps.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      testId: node.getAttribute("data-testid"),
      nth,
    });
  }
  return steps.slice(0, 8);
}
