// The entry script of the documentation page: it lays out the process
// definition of the page with the studio layout and draws the diagram.

import { diagramSvg } from "./studio/doc-svg";
import { layoutProcess } from "./studio/layout";
import type { ProcessDefinition } from "./studio/types";

const box = document.getElementById("diagram")!;
try {
  const def = JSON.parse(document.getElementById("process-definition")!.textContent!) as ProcessDefinition;
  box.innerHTML = diagramSvg(await layoutProcess(def), def);
} catch {
  box.textContent = "The diagram cannot be drawn.";
}
