import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createEditor, type EditorHandle, type EditorMode } from "./index";

const doc = `行内 \`inline\` 代码

\`\`\`js
const a = 1;

const b = 2;
\`\`\`

    indented
    code
`;

let parent: HTMLElement;
let editor: EditorHandle;

async function settle() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => resolve()),
  );
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
});

describe.each(["live", "immersive", "source"] as EditorMode[])(
  "code block background in %s mode",
  (mode) => {
    it("draws one block-sized background for fenced and indented code", async () => {
      editor = createEditor({ parent, doc, mode });
      const view = editor.view;
      await settle();

      const codeLines = [
        ...view.contentDOM.querySelectorAll(".cm-nicole-code-line"),
      ];
      expect(codeLines).toHaveLength(7);
      expect(codeLines.some((line) => line.textContent?.includes("inline"))).toBe(
        false,
      );

      const backgrounds = [
        ...view.scrollDOM.querySelectorAll<HTMLElement>(".cm-nicole-code-bg"),
      ];
      expect(backgrounds).toHaveLength(2);
      for (const background of backgrounds) {
        expect(background.classList).toContain("cm-nicole-code-bg-start");
        expect(background.classList).toContain("cm-nicole-code-bg-end");
        expect(Number.parseFloat(background.style.height)).toBeGreaterThan(0);
      }
      // Five fenced lines share one rectangle, so the empty line inside the
      // block cannot leave a gap between per-line backgrounds.
      expect(Number.parseFloat(backgrounds[0]!.style.height)).toBeGreaterThan(
        Number.parseFloat(backgrounds[1]!.style.height),
      );
    });
  },
);

it("keeps the code background below the selection layer", async () => {
  editor = createEditor({ parent, doc, mode: "live" });
  const view = editor.view;
  await settle();

  const background = view.scrollDOM.querySelector<HTMLElement>(
    ".cm-nicole-code-bg-layer",
  )!;
  const selection = view.scrollDOM.querySelector<HTMLElement>(
    ".cm-selectionLayer",
  )!;
  expect(Number(background.style.zIndex)).toBeLessThan(
    Number(selection.style.zIndex),
  );
});
