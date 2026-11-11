import { createApp, h, nextTick, type App as VueApp } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorHandle } from "../editor";
import FindReplacePanel from "./FindReplacePanel.vue";

let editorParent: HTMLElement;
let panelParent: HTMLElement;
let editor: EditorHandle | null = null;
let app: VueApp | null = null;

function mount(doc = "foo foo", platform: "macos" | "windows" = "macos") {
  editor = createEditor({ parent: editorParent, doc, mode: "live", platform });
  const controller = editor.search;
  app = createApp({
    setup() {
      return () =>
        h(FindReplacePanel, { controller, platform });
    },
  });
  app.mount(panelParent);
  return editor;
}

async function settle() {
  await nextTick();
  await nextTick();
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-find-replace]");
}

function findInput(): HTMLInputElement {
  const input = panel()?.querySelector<HTMLInputElement>(
    'input[aria-label="查找"]',
  );
  if (!input) throw new Error("find input not found");
  return input;
}

function replaceInput(): HTMLInputElement {
  const input = panel()?.querySelector<HTMLInputElement>(
    'input[aria-label="替换为"]',
  );
  if (!input) throw new Error("replace input not found");
  return input;
}

function iconButton(label: string): HTMLButtonElement {
  const button = panel()?.querySelector<HTMLButtonElement>(
    `button[aria-label^="${label}"]`,
  );
  if (!button) throw new Error(`button ${label} not found`);
  return button;
}

function textButton(label: string): HTMLButtonElement {
  const button = [...(panel()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`button ${label} not found`);
  return button;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function countText(): string {
  return panel()?.textContent?.replace(/\s+/g, " ") ?? "";
}

beforeEach(() => {
  document.body.innerHTML = '<div id="editor"></div><div id="panel"></div>';
  editorParent = document.querySelector<HTMLElement>("#editor")!;
  panelParent = document.querySelector<HTMLElement>("#panel")!;
  editorParent.style.height = "600px";
});

afterEach(() => {
  app?.unmount();
  app = null;
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

describe("FindReplacePanel", () => {
  it("shows only the find row on open and reveals replace from the registry", async () => {
    const instance = mount();
    instance.search.open(false);
    await settle();

    const root = panel()!;
    expect(root.getAttribute("role")).toBe("search");
    expect(root.style.top).toBe("8px");
    expect(root.style.right).toBe("14px");
    expect(root.style.width).toContain("380px");
    expect(root.style.width).toContain("100%");
    expect(document.activeElement).toBe(findInput());
    expect(panel()?.querySelector('input[aria-label="替换为"]')).toBeNull();

    findInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        altKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(replaceInput()).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(findInput());

    findInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "f",
        code: "KeyF",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(panel()?.querySelector('input[aria-label="替换为"]')).toBeNull();
  });

  it("updates counts, navigates and replaces through the panel controls", async () => {
    const instance = mount("foo foo");
    instance.search.open(true);
    await settle();

    type(findInput(), "foo");
    await settle();
    expect(countText()).toContain("0/2");
    expect(
      instance.view.contentDOM.querySelectorAll(".cm-searchMatch"),
    ).toHaveLength(2);

    iconButton("下一个匹配").click();
    await settle();
    expect(countText()).toContain("1/2");
    iconButton("下一个匹配").click();
    await settle();
    expect(countText()).toContain("2/2");
    iconButton("上一个匹配").click();
    await settle();
    expect(countText()).toContain("1/2");

    type(replaceInput(), "bar");
    await settle();
    textButton("全部替换").click();
    await settle();
    expect(instance.view.state.doc.toString()).toBe("bar bar");
    expect(countText()).toContain("0/0");

    instance.undo();
    await settle();
    expect(instance.view.state.doc.toString()).toBe("foo foo");
  });

  it("keeps an invalid regular expression stable and disables replacement", async () => {
    const instance = mount("a+ b");
    instance.search.open(true);
    await settle();

    panel()!
      .querySelector<HTMLButtonElement>('button[aria-label="使用正则表达式"]')!
      .click();
    type(findInput(), "(");
    await settle();

    expect(countText()).toContain("正则无效");
    expect(textButton("替换").disabled).toBe(true);
    expect(textButton("全部替换").disabled).toBe(true);
    expect(instance.view.state.doc.toString()).toBe("a+ b");
  });

  it("announces state and exposes named toggle buttons", async () => {
    const instance = mount("foo");
    instance.search.open(false);
    await settle();

    const status = panel()!.querySelector<HTMLElement>(
      '[role="status"][aria-live="polite"]',
    )!;
    expect(status.textContent).toBe("查找内容为空");

    type(findInput(), "foo");
    await settle();
    expect(status.textContent).toBe("未选中匹配，共 1 项");

    type(findInput(), "zzz");
    await settle();
    expect(status.textContent).toBe("无匹配");
    expect(panel()?.textContent).toContain("0/0");
    expect(iconButton("下一个匹配").disabled).toBe(true);

    type(findInput(), "foo");
    await settle();

    const caseToggle = panel()!.querySelector<HTMLButtonElement>(
      'button[aria-label="区分大小写"]',
    )!;
    expect(caseToggle.getAttribute("aria-pressed")).toBe("false");
    caseToggle.click();
    await settle();
    expect(caseToggle.getAttribute("aria-pressed")).toBe("true");
    const regexToggle = panel()!.querySelector<HTMLButtonElement>(
      'button[aria-label="使用正则表达式"]',
    )!;
    expect(regexToggle.getAttribute("aria-pressed")).toBe("false");
    expect(iconButton("关闭").getAttribute("aria-label")).toBe("关闭");
  });

  it("leaves IME keys to the candidate window, then closes with Escape", async () => {
    const instance = mount("foo foo");
    instance.search.open(false);
    await settle();
    const input = findInput();
    const before = instance.view.state.selection.main;

    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(composingEnter);
    await settle();
    expect(composingEnter.defaultPrevented).toBe(false);
    expect(instance.view.state.selection.main).toEqual(before);

    const composingEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(composingEscape);
    await settle();
    expect(composingEscape.defaultPrevented).toBe(false);
    expect(panel()).not.toBeNull();

    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(escape);
    await settle();
    expect(escape.defaultPrevented).toBe(true);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(instance.view.contentDOM);
  });

  it("stops Escape from reaching lower layers", async () => {
    const instance = mount();
    instance.search.open(false);
    await settle();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    try {
      findInput().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          code: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
      await settle();
      expect(onWindow).not.toHaveBeenCalled();
      expect(panel()).toBeNull();
    } finally {
      window.removeEventListener("keydown", onWindow);
    }
  });
});
