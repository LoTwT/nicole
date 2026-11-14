import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commandRegistry } from "../commands/registry";
import { shortcutSections } from "../commands/shortcuts";
import SettingsView from "./SettingsView.vue";

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 6; index++) await nextTick();
}

function mount(overrides: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const props = reactive({
    platform: "macos" as const,
    theme: "system" as const,
    uiFont: "",
    readingFont: "",
    codeFont: "",
    showAllFiles: true,
    hideMarkdownExtension: true,
    formatToolbarVisible: false,
    slashEnabled: { live: true, immersive: true, source: true },
    ...overrides,
  });
  const Component = defineComponent({
    setup() {
      return () =>
        h(SettingsView, {
          ...props,
          onUpdateTheme: (value: unknown) => calls.push(["theme", value]),
          "onUpdate:theme": (value: unknown) => calls.push(["theme", value]),
          onUpdateFont: (field: unknown, value: unknown) =>
            calls.push(["font", field, value]),
          "onUpdate:font": (field: unknown, value: unknown) =>
            calls.push(["font", field, value]),
          onUpdateShowAllFiles: (value: unknown) =>
            calls.push(["show-all-files", value]),
          "onUpdate:show-all-files": (value: unknown) =>
            calls.push(["show-all-files", value]),
          onUpdateHideMarkdownExtension: (value: unknown) =>
            calls.push(["hide-markdown-extension", value]),
          "onUpdate:hide-markdown-extension": (value: unknown) =>
            calls.push(["hide-markdown-extension", value]),
          onUpdateFormatToolbarVisible: (value: unknown) =>
            calls.push(["format-toolbar-visible", value]),
          "onUpdate:format-toolbar-visible": (value: unknown) =>
            calls.push(["format-toolbar-visible", value]),
          onUpdateSlashEnabled: (mode: unknown, value: unknown) =>
            calls.push(["slash-enabled", mode, value]),
          "onUpdate:slash-enabled": (mode: unknown, value: unknown) =>
            calls.push(["slash-enabled", mode, value]),
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
  return { calls, props };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector<HTMLElement>("#app")!;
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("SettingsView", () => {
  it("renders the four groups at the reading width and focuses the first control", async () => {
    mount();
    await settle();
    const view = host.querySelector<HTMLElement>("[data-settings-view]")!;
    expect(view).not.toBeNull();
    expect(view.querySelector(".max-w-\\[720px\\]")).not.toBeNull();
    const headings = [...host.querySelectorAll("h2")].map((item) =>
      item.textContent?.trim(),
    );
    expect(headings).toEqual(["外观", "文件树", "编辑", "快捷键"]);
    expect(document.activeElement).toBe(
      host.querySelector("#settings-theme"),
    );
  });

  it("keeps the stored .md preference visible but disabled while all files show", async () => {
    mount({ hideMarkdownExtension: true, showAllFiles: true });
    await settle();
    const checkboxes = host.querySelectorAll<HTMLInputElement>(
      '[data-settings-group="file-tree"] input[type=checkbox]',
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]!.checked).toBe(true);
    expect(checkboxes[1]!.checked).toBe(true);
    expect(checkboxes[1]!.disabled).toBe(true);
  });

  it("emits immediate theme, font, tree and editing changes", async () => {
    const { calls } = mount({ showAllFiles: false });
    await settle();
    const theme = host.querySelector<HTMLSelectElement>("#settings-theme")!;
    theme.value = "dark";
    theme.dispatchEvent(new Event("change"));
    const font = host.querySelector<HTMLInputElement>("#settings-reading-font")!;
    font.value = "Songti SC";
    font.dispatchEvent(new Event("input"));
    const showAll = host.querySelectorAll<HTMLInputElement>(
      '[data-settings-group="file-tree"] input[type=checkbox]',
    )[0]!;
    showAll.checked = false;
    showAll.dispatchEvent(new Event("change"));
    const hide = host.querySelectorAll<HTMLInputElement>(
      '[data-settings-group="file-tree"] input[type=checkbox]',
    )[1]!;
    hide.checked = true;
    hide.dispatchEvent(new Event("change"));
    const slash = host.querySelector<HTMLInputElement>(
      '[data-slash-mode="immersive"]',
    )!;
    slash.checked = false;
    slash.dispatchEvent(new Event("change"));
    expect(calls).toEqual(
      expect.arrayContaining([
        ["theme", "dark"],
        ["font", "reading", "Songti SC"],
        ["show-all-files", false],
        ["hide-markdown-extension", true],
        ["slash-enabled", "immersive", false],
      ]),
    );
  });

  it("resets a font field to the built-in stack", async () => {
    const { calls } = mount({ readingFont: "Songti SC" });
    await settle();
    const reset = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === "系统默认",
    )!;
    expect(reset).toBeTruthy();
    reset.click();
    expect(calls).toContainEqual(["font", "ui", ""]);
  });

  it("lists every platform binding, including second bindings and history help", async () => {
    mount();
    await settle();
    const next = host.querySelector('[data-shortcut-id="tab.next"]')!;
    expect(next.textContent).toContain("⌃Tab");
    expect(next.textContent).toContain("⇧⌘]");
    expect(host.querySelector('[data-shortcut-id="app.settings"]')).not.toBeNull();
    expect(host.querySelector('[data-shortcut-id="editor.undo"]')).not.toBeNull();
    expect(host.querySelector('[data-shortcut-id="general.escape"]')).not.toBeNull();
    const headings = [...host.querySelectorAll("h3")].map((item) =>
      item.textContent?.trim(),
    );
    for (const label of ["文件", "导航", "标签页", "查找", "格式", "段落"]) {
      expect(headings).toContain(label);
    }
    const sections = shortcutSections(commandRegistry, "macos");
    const expected = sections.flatMap((section) =>
      section.entries.map((entry) => entry.id),
    );
    const rendered = [
      ...host.querySelectorAll<HTMLElement>("[data-shortcut-id]"),
    ]
      .map((item) => item.dataset.shortcutId)
      .filter((id) => id !== "editor.undo" && id !== "editor.redo" && id !== "general.escape");
    expect(rendered).toEqual(expected);
  });
});
