import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EditorHandle, InsertionTicket } from "./editor";
import { createImageInsertion } from "./image-insertion";
import { importImages, pasteImage } from "./services/assets";

vi.mock("./services/assets", () => ({
  pasteImage: vi.fn(),
  importImages: vi.fn(),
}));

const ticket: InsertionTicket = { id: 7 };

function fakeEditor() {
  const editor = {
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

    insertion.handleDropFiles();
    insertion.handleDrop({ token: "token-1", x: 120, y: 240 });
    await settle();

    expect(editor.createInsertionTicket).toHaveBeenCalledWith(120, 240);
    expect(importImages).toHaveBeenCalledWith("note.md", 3, "token-1");
    expect(editor.insertImages).toHaveBeenCalledWith(ticket, [
      "![](assets/photo.png)",
    ]);
  });

  it("does not import a native drop the editor did not see", async () => {
    const editor = fakeEditor();
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handleDrop({ token: "token-1", x: 120, y: 240 });
    await settle();

    expect(importImages).not.toHaveBeenCalled();
    expect(editor.insertImages).not.toHaveBeenCalled();
  });

  it("does not insert when the editor rejected the drop position", async () => {
    const editor = fakeEditor();
    vi.mocked(editor.createInsertionTicket).mockReturnValue(null);
    const insertion = createImageInsertion({
      getEditor: () => editor,
      getFile: () => "note.md",
      getGeneration: () => 3,
    });

    insertion.handleDropFiles();
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

    insertion.handleDropFiles();
    insertion.handleDrop({ token: "bad", x: 1, y: 2 });
    await settle();

    expect(editor.insertImages).toHaveBeenCalledWith(ticket, []);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
