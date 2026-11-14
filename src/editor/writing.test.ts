import { afterEach, expect, it, vi } from "vitest";
import { createEditor } from "./index";
import { setCommandKeybindings } from "../commands/keybinding-settings";
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", {
    value: "MacIntel",
    configurable: true,
  });
});
const editors: ReturnType<typeof createEditor>[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  document.body.replaceChildren();
  setCommandKeybindings({});
  vi.useRealTimers();
});
function mount() {
  const parent = document.body.appendChild(document.createElement("div"));
  const editor = createEditor({
    parent,
    doc: "第一段\n\n第二段",
    platform: "macos",
  });
  editors.push(editor);
  return editor;
}
it("toggles writing modes without replacing the view or losing undo and selection", () => {
  const editor = mount(),
    view = editor.view;
  view.dispatch({
    changes: { from: 3, insert: "内容" },
    selection: { anchor: 5 },
  });
  editor.setWritingPreferences({ focusMode: true, typewriterMode: true });
  expect(editor.view).toBe(view);
  expect(view.state.doc.toString()).toBe("第一段内容\n\n第二段");
  expect(view.state.selection.main.head).toBe(5);
  expect(view.dom.classList.contains("cm-nicole-focus")).toBe(true);
  expect(
    view.dom.querySelectorAll(".cm-nicole-unfocused").length,
  ).toBeGreaterThan(0);
  expect(editor.undo()).toBe(true);
  expect(view.state.doc.toString()).toBe("第一段\n\n第二段");
  editor.setWritingPreferences({ focusMode: false, typewriterMode: false });
  expect(view.dom.querySelector(".cm-nicole-unfocused")).toBeNull();
});
it("refreshes shortcuts in the existing view and suppresses the former default", () => {
  const editor = mount(),
    view = editor.view;
  setCommandKeybindings({ "format.bold": "Mod-Alt-b" });
  editor.refreshKeybindings();
  view.dispatch({ selection: { anchor: 0, head: 3 } });
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(view.state.doc.toString()).toBe("第一段\n\n第二段");
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(view.state.doc.toString()).toBe("**第一段**\n\n第二段");
  expect(editor.view).toBe(view);
});
