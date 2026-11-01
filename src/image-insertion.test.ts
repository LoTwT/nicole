import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorHandle, InsertionTicket } from "./editor";
import { createEditor } from "./editor";
import { createImageInsertion } from "./image-insertion";
import { importImages, pasteImage } from "./services/assets";

vi.mock("./services/assets", () => ({
  pasteImage: vi.fn(),
  importImages: vi.fn(),
}));

const ticket: InsertionTicket = { id: 7 };

function fakeEditor() {
  const editor = {
    containsPoint: vi.fn(() => true),
    createInsertionTicket: vi.fn(() => ticket),
    insertImages: vi.fn(),
  } as unknown as EditorHandle;
  return editor;
}

async function settle() {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

beforeEach(() => {
  vi.mocked(pasteImage).mockReset();
  vi.mocked(importImages).mockReset();
});

describe("createImageInsertion", () => {
  it("pastes through Go and inserts the returned Markdown", async () => {
    const editor = fakeEditor();
    vi.mocked(pasteImage).mockResolvedValue([
      { path: "assets/a.png", markdown: "![](assets/a.png)" },
    ]);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handlePaste(ticket);
    await settle();

    expect(pasteImage).toHaveBeenCalledWith("note.md", 3);
    expect(editor.insertImages).toHaveBeenCalledWith(ticket, [
      "![](assets/a.png)",
    ]);
  });

  it("imports a native drop at the event coordinates", async () => {
    const editor = fakeEditor();
    vi.mocked(importImages).mockResolvedValue([
      { path: "assets/photo.png", markdown: "![](assets/photo.png)" },
    ]);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handleDrop({ token: "token-1", x: 120, y: 240 });
    await settle();

    expect(editor.createInsertionTicket).toHaveBeenCalledWith(120, 240);
    expect(importImages).toHaveBeenCalledWith("note.md", 3, "token-1");
    expect(editor.insertImages).toHaveBeenCalledWith(ticket, [
      "![](assets/photo.png)",
    ]);
  });

  it("does not import a native drop outside the editor", async () => {
    const editor = fakeEditor();
    vi.mocked(editor.containsPoint).mockReturnValue(false);
    vi.mocked(importImages).mockResolvedValue([]);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handleDrop({ token: "token-1", x: 900, y: 320 });
    await settle();

    expect(editor.containsPoint).toHaveBeenCalledWith(900, 320);
    expect(importImages).not.toHaveBeenCalled();
    expect(editor.createInsertionTicket).not.toHaveBeenCalled();
    expect(editor.insertImages).not.toHaveBeenCalled();
  });

  it("does not import a native drop outside the editor after a no-path DOM drop", async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const parent = document.querySelector<HTMLElement>("#host")!;
    const editor = createEditor({ parent, doc: "hello" });
    vi.mocked(importImages).mockResolvedValue([]);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    const elementFromPoint = vi
      .spyOn(document, "elementFromPoint")
      .mockReturnValue(outside);

    try {
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          files: [new File(["image"], "photo.png", { type: "image/png" })],
          types: ["Files"],
        },
      });
      editor.view.contentDOM.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      insertion.handleDrop({ token: "token-1", x: 900, y: 320 });
      await settle();

      expect(importImages).not.toHaveBeenCalled();
      expect(editor.view.state.doc.toString()).toBe("hello");
    } finally {
      elementFromPoint.mockRestore();
      editor.destroy();
    }
  });

  it("does not insert when the editor rejected the drop position", async () => {
    const editor = fakeEditor();
    vi.mocked(editor.createInsertionTicket).mockReturnValue(null);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handleDrop({ token: "token-1", x: 1, y: 2 });
    await settle();

    expect(importImages).not.toHaveBeenCalled();
  });

  it("does not insert images after the file changed", async () => {
    const editor = fakeEditor();
    let file = "one.md";
    vi.mocked(pasteImage).mockResolvedValue([
      { path: "assets/a.png", markdown: "![](assets/a.png)" },
    ]);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => file,
      getGeneration: () => 3,
    });

    insertion.handlePaste(ticket);
    file = "two.md";
    await settle();

    expect(editor.insertImages).toHaveBeenCalledWith(ticket, []);
  });

  it("reports an unknown or failed token without inserting", async () => {
    const editor = fakeEditor();
    const onError = vi.fn();
    vi.mocked(importImages).mockRejectedValue(new Error("unknown token"));
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
      onError,
    });

    insertion.handleDrop({ token: "bad", x: 1, y: 2 });
    await settle();

    expect(editor.insertImages).toHaveBeenCalledWith(ticket, []);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
