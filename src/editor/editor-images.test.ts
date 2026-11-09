import { undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "./index";

const doc = "# 标题\n\n正文\n";

let parent: HTMLElement;
let editor: EditorHandle | null = null;

function mount(options: Parameters<typeof createEditor>[0] = { parent, doc }) {
  editor = createEditor(options);
  return editor;
}

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function ticketAt(instance: EditorHandle, at: number) {
  vi.spyOn(instance.view, "posAtCoords").mockReturnValue(at);
  const ticket = instance.createInsertionTicket(0, 0);
  if (!ticket) throw new Error("ticket was not created");
  return ticket;
}

function pasteEvent(items: Array<{ kind: string; type: string }>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      items,
      files: [],
      types: items.map((item) => item.type),
      getData: () => "",
    },
  });
  return event;
}

function dropEvent(types: string[]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      files: [new File(["image"], "photo.png", { type: "image/png" })],
      types,
    },
  });
  return event;
}

function composition(
  view: EditorView,
  type: "compositionstart" | "compositionend",
) {
  view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  parent = document.querySelector<HTMLElement>("#host")!;
  parent.style.height = "600px";
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("image insertion", () => {
  it("reports an image paste ticket and blocks the default paste", () => {
    const onPasteImage = vi.fn();
    const instance = mount({ parent, doc, onPasteImage });
    const view = instance.view;
    view.dispatch({ selection: { anchor: 3 } });

    const event = pasteEvent([{ kind: "file", type: "image/png" }]);
    view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onPasteImage).toHaveBeenCalledTimes(1);
    const ticket = onPasteImage.mock.calls[0]![0];
    instance.insertImages(ticket, ["![](a.png)"]);
    expect(view.state.doc.toString()).toBe("# 标![](a.png)题\n\n正文\n");
  });

  it("leaves text-only paste to the editor", () => {
    const onPasteImage = vi.fn();
    const instance = mount({ parent, doc, onPasteImage });

    const event = pasteEvent([{ kind: "string", type: "text/plain" }]);
    instance.view.contentDOM.dispatchEvent(event);

    expect(onPasteImage).not.toHaveBeenCalled();
  });

  it("blocks the browser default for file drops", () => {
    const instance = mount();

    const event = dropEvent(["Files"]);
    instance.view.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("detects whether a point is inside the editor", () => {
    const instance = mount();
    const inside = document.createElement("span");
    instance.view.dom.appendChild(inside);
    const elementFromPoint = vi
      .spyOn(document, "elementFromPoint")
      .mockReturnValue(inside);

    expect(instance.containsPoint(10, 20)).toBe(true);

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    elementFromPoint.mockReturnValue(outside);

    expect(instance.containsPoint(10, 20)).toBe(false);
    elementFromPoint.mockRestore();
  });

  it("creates a ticket only for points inside the editor", () => {
    const instance = mount();
    vi.spyOn(instance.view, "posAtCoords").mockReturnValue(null);

    expect(instance.createInsertionTicket(1, 2)).toBeNull();
  });

  it("inserts Markdown as one undo step", () => {
    const instance = mount();
    const view = instance.view;
    const ticket = ticketAt(instance, 0);

    instance.insertImages(ticket, ["![](a.png)", "![](b.png)"]);

    expect(view.state.doc.toString()).toBe("![](a.png)\n![](b.png)\n" + doc);
    undo(view);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("puts an image above a block when the ticket is at its content start", () => {
    const instance = mount({ parent, doc: "- [ ] 文本\n", mode: "immersive" });
    const view = instance.view;
    view.dispatch({ selection: { anchor: 6 } });
    const ticket = ticketAt(instance, 6);

    instance.insertImages(ticket, ["![](a.png)"]);

    expect(view.state.doc.toString()).toBe("![](a.png)\n- [ ] 文本\n");
    expect(view.state.selection.main.head).toBe(17);
  });

  for (const [name, source, at] of [
    ["task", "- [ ] 甲\n", 1],
    ["quote list", "> - 甲\n", 2],
    ["nested quote", "> > 甲\n", 2],
  ] as const) {
    it(`puts an image above a ${name} when the point is inside its marker`, () => {
      const instance = mount({ parent, doc: source, mode: "immersive" });
      const ticket = ticketAt(instance, at);

      instance.insertImages(ticket, ["![](a.png)"]);

      expect(instance.view.state.doc.toString()).toBe(`![](a.png)\n${source}`);
    });
  }

  it("puts an image above an ordered-list block at the content start", () => {
    const instance = mount({ parent, doc: "1. 文本\n", mode: "immersive" });
    const ticket = ticketAt(instance, 3);

    instance.insertImages(ticket, ["![](a.png)"]);

    expect(instance.view.state.doc.toString()).toBe("![](a.png)\n1. 文本\n");
    expect(instance.view.state.selection.main.head).toBe(14);
  });

  for (const mode of ["live", "source"] as const) {
    it(`keeps baseline image placement in ${mode} mode`, () => {
      const instance = mount({ parent, doc: "- 文本\n", mode });
      const ticket = ticketAt(instance, 2);

      instance.insertImages(ticket, ["![](a.png)"]);

      expect(instance.view.state.doc.toString()).toBe("- ![](a.png)文本\n");
    });
  }

  for (const [name, doc, lineNumber, offset, expected] of [
    [
      "a loose continuation list item",
      "- 甲\n\n- 乙\n",
      3,
      2,
      "- 甲\n\n- ![](a.png)乙\n",
    ],
    [
      "a continuation quote line",
      "> 甲\n>\n> 乙\n",
      3,
      2,
      "> 甲\n>\n> ![](a.png)乙\n",
    ],
    [
      "an indented continuation list item",
      "- 甲\n  - 乙\n",
      2,
      4,
      "- 甲\n  - ![](a.png)乙\n",
    ],
  ] as const) {
    it(`keeps baseline image placement on ${name}`, () => {
      const instance = mount({ parent, doc, mode: "immersive" });
      const line = instance.view.state.doc.line(lineNumber);
      const ticket = ticketAt(instance, line.from + offset);

      instance.insertImages(ticket, ["![](a.png)"]);

      expect(instance.view.state.doc.toString()).toBe(expected);
    });
  }

  for (const [name, doc, lineNumber, offset, expected] of [
    [
      "an ordered continuation item at the line left",
      "1. 甲\n2. 乙\n",
      2,
      0,
      "1. 甲\n2. ![](a.png)乙\n",
    ],
    [
      "an ordered continuation item inside its number",
      "1. 甲\n12. 乙\n",
      2,
      1,
      "1. 甲\n12. ![](a.png)乙\n",
    ],
    [
      "a bullet continuation item at the line left",
      "- 甲\n- 乙\n",
      2,
      0,
      "- 甲\n- ![](a.png)乙\n",
    ],
  ] as const) {
    it(`does not split ${name} when placing an image`, () => {
      const instance = mount({ parent, doc, mode: "immersive" });
      const line = instance.view.state.doc.line(lineNumber);
      const ticket = ticketAt(instance, line.from + offset);

      instance.insertImages(ticket, ["![](a.png)"]);

      expect(instance.view.state.doc.toString()).toBe(expected);
    });
  }

  it("inserts an image inside an empty block instead of above it", () => {
    const instance = mount({ parent, doc: "- \n" });
    const ticket = ticketAt(instance, 2);

    instance.insertImages(ticket, ["![](a.png)"]);

    expect(instance.view.state.doc.toString()).toBe("- ![](a.png)\n");
    expect(instance.view.state.selection.main.head).toBe(12);
  });

  it("maps a ticket through edits before the image arrives", () => {
    const instance = mount();
    const view = instance.view;
    const ticket = ticketAt(instance, 6);

    view.dispatch({ changes: { from: 0, insert: "XY" } });
    instance.insertImages(ticket, ["![](a.png)"]);

    expect(view.state.doc.toString()).toBe(
      "XY# 标题\n\n![](a.png)\n正文\n",
    );
  });

  it("keeps image insertion separate from typing before it", () => {
    const instance = mount();
    const view = instance.view;

    view.dispatch({ changes: { from: 0, insert: "输入" }, selection: { anchor: 2 } });
    const ticket = ticketAt(instance, 2);
    view.dispatch({ changes: { from: 0, insert: "前缀" } });
    instance.insertImages(ticket, ["![](a.png)"]);

    undo(view);
    expect(view.state.doc.toString()).toBe("前缀输入" + doc);
  });

  it("maps a queued ticket through edits during an IME composition", async () => {
    const instance = mount();
    const view = instance.view;
    composition(view, "compositionstart");
    const ticket = ticketAt(instance, 6);

    view.dispatch({ changes: { from: 0, insert: "XY" } });
    instance.insertImages(ticket, ["![](a.png)"]);
    expect(view.state.doc.toString()).toBe("XY" + doc);

    composition(view, "compositionend");
    await settle();

    expect(view.state.doc.toString()).toBe(
      "XY# 标题\n\n![](a.png)\n正文\n",
    );
  });

  it("maps the second of two queued insertions", async () => {
    const instance = mount();
    const view = instance.view;
    composition(view, "compositionstart");
    const first = ticketAt(instance, 6);
    const second = ticketAt(instance, 6);

    instance.insertImages(first, ["![](a.png)"]);
    instance.insertImages(second, ["![](b.png)"]);
    composition(view, "compositionend");
    await settle();

    expect(view.state.doc.toString()).toBe(
      "# 标题\n\n![](a.png)\n![](b.png)\n正文\n",
    );
  });

  it("waits for an IME composition before inserting", async () => {
    const instance = mount();
    const view = instance.view;
    composition(view, "compositionstart");
    const ticket = ticketAt(instance, 0);

    instance.insertImages(ticket, ["![](a.png)"]);
    expect(view.state.doc.toString()).toBe(doc);

    composition(view, "compositionend");
    await settle();

    expect(view.state.doc.toString()).toBe("![](a.png)\n" + doc);
  });

  it("releases a ticket for an empty insertion", () => {
    const instance = mount();
    const view = instance.view;
    const ticket = ticketAt(instance, 0);

    instance.insertImages(ticket, []);
    instance.insertImages(ticket, ["![](a.png)"]);

    expect(view.state.doc.toString()).toBe(doc);
  });
});
