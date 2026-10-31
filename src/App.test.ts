import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { createApp, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.vue";
import { SAMPLE_DOCUMENT } from "./sample";

vi.mock("./services/app", () => ({
  getAppInfo: async () => ({
    version: "0.0.1",
    os: "test",
    arch: "test",
    goVersion: "go1.test",
  }),
}));

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  document.documentElement.classList.remove("dark");
  localStorage.clear();

  host = document.querySelector<HTMLElement>("#app")!;
  app = createApp(App);
  app.mount(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("App", () => {
  it("keeps the editor DOM, selection and undo history when the theme changes", async () => {
    await nextTick();

    const editorDOM = host.querySelector<HTMLElement>(".cm-editor");
    expect(editorDOM).not.toBeNull();

    const view = EditorView.findFromDOM(editorDOM!);
    expect(view).not.toBeNull();

    view!.dispatch({
      changes: { from: 0, insert: "X" },
      selection: { anchor: 6, head: 10 },
    });
    await nextTick();

    const selection = view!.state.selection.main;
    const edited = view!.state.doc.toString();
    const themeButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(themeButton).not.toBeNull();

    themeButton!.click();
    await nextTick();

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(host.querySelector(".cm-editor")).toBe(editorDOM);
    expect(view!.state.selection.main.eq(selection)).toBe(true);
    expect(view!.state.doc.toString()).toBe(edited);

    undo(view!);
    expect(view!.state.doc.toString()).toBe(SAMPLE_DOCUMENT);
  });
});
