import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPlatform } from "../app/platform";
import type { FormatToolbarState } from "../commands/format";
import FormatToolbar from "./FormatToolbar.vue";

let app: ReturnType<typeof createApp> | null = null;

function state(
  active: readonly string[] = [],
  paragraph = "format.paragraph",
): FormatToolbarState {
  return { active: new Set(active), paragraph };
}

async function mountToolbar(
  options: {
    platform?: AppPlatform;
    active?: FormatToolbarState;
    disabled?: boolean;
  } = {},
) {
  const disabled = ref(options.disabled ?? false);
  const active = ref(options.active ?? state());
  const runs: string[] = [];
  const events: string[] = [];
  const Host = defineComponent({
    setup() {
      return () =>
        h(FormatToolbar, {
          platform: options.platform ?? "macos",
          active: active.value,
          disabled: disabled.value,
          onRun: (id: string) => runs.push(id),
          "onMenus-will-open": () => events.push("menus"),
          "onFocus-editor": () => events.push("editor"),
        });
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(Host);
  app.mount("#app");
  await nextTick();
  await nextTick();
  return {
    root: document.querySelector<HTMLElement>("[data-format-toolbar]")!,
    runs,
    events,
    disabled,
    active,
  };
}

function commandButtons(root: HTMLElement): HTMLButtonElement[] {
  const row = root.querySelector<HTMLElement>("[data-format-row]")!;
  return [...row.querySelectorAll<HTMLButtonElement>("[data-format-command]")];
}

function menuButtons(root: HTMLElement, menu: "paragraph" | "more") {
  return [
    ...root.querySelectorAll<HTMLButtonElement>(
      `[data-format-menu="${menu}"] [data-format-command]`,
    ),
  ];
}

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height: 28,
    top: 0,
    right: width,
    bottom: 28,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  app?.unmount();
  app = null;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("FormatToolbar", () => {
  it("renders the three registry groups with names, keys and active state", async () => {
    const { root, runs } = await mountToolbar({
      active: state(["format.bold", "format.bullet-list"]),
    });

    const ids = commandButtons(root).map(
      (button) => button.dataset.formatCommand,
    );
    expect(ids).toEqual([
      "format.bold",
      "format.italic",
      "format.strikethrough",
      "format.inline-code",
      "format.link",
      "format.bullet-list",
      "format.ordered-list",
      "format.task-list",
      "format.quote",
      "format.code-block",
      "insert.table",
      "insert.image",
    ]);
    expect(root.querySelectorAll("[data-format-row] > span").length).toBe(2);

    const bold = root.querySelector<HTMLElement>('[data-format-command="format.bold"]')!;
    expect(bold.title).toBe("加粗 ⌘B");
    expect(bold.getAttribute("aria-label")).toBe("加粗 ⌘B");
    expect(bold.dataset.active).toBe("");
    expect(
      root.querySelector('[data-format-command="insert.table"]')!.getAttribute("title"),
    ).toBe("表格");
    expect(root.querySelector("[data-format-paragraph-trigger]")?.textContent).toContain(
      "正文",
    );

    bold.click();
    expect(runs).toEqual(["format.bold"]);
  });

  it("renders the paragraph dropdown as real menu DOM and returns Esc to its trigger", async () => {
    const { root } = await mountToolbar({
      active: state(["format.heading-2"], "format.heading-2"),
    });

    const trigger = root.querySelector<HTMLButtonElement>(
      "[data-format-paragraph-trigger]",
    )!;
    expect(trigger.textContent).toContain("标题 2");
    trigger.click();
    await nextTick();

    const items = menuButtons(root, "paragraph");
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "正文",
      "标题 1⌘1",
      "标题 2⌘2",
      "标题 3⌘3",
    ]);
    expect(
      items[2]!.getAttribute("aria-checked"),
    ).toBe("true");
    expect(document.activeElement).toBe(items[0]);

    items[0]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    expect(root.querySelector('[data-format-menu="paragraph"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves commands that do not fit into More without duplicating them", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.hasAttribute("data-format-toolbar")) return rect(200);
        const key = this.getAttribute("data-measure-key");
        if (key === "__more") return rect(28);
        if (key === "paragraph") return rect(88);
        if (key !== null) return rect(28);
        return rect(0);
      },
    );

    const { root, runs, events } = await mountToolbar();

    const visible = commandButtons(root).map(
      (button) => button.dataset.formatCommand,
    );
    expect(visible).toEqual([
      "format.bold",
      "format.italic",
      "format.strikethrough",
      "format.inline-code",
    ]);

    const more = root.querySelector<HTMLButtonElement>("[data-format-more]")!;
    expect(more).not.toBeNull();
    more.click();
    await nextTick();
    expect(events).toContain("menus");
    expect(document.activeElement).toBe(
      root.querySelector('[data-format-menu="more"] [data-format-command]'),
    );

    const moved = menuButtons(root, "more").map(
      (button) => button.dataset.formatCommand,
    );
    expect(moved).toEqual([
      "format.link",
      "format.paragraph",
      "format.heading-1",
      "format.heading-2",
      "format.heading-3",
      "format.bullet-list",
      "format.ordered-list",
      "format.task-list",
      "format.quote",
      "format.code-block",
      "insert.table",
      "insert.image",
    ]);
    expect(moved.filter((id) => visible.includes(id!))).toEqual([]);
    expect(new Set([...visible, ...moved]).size).toBe(16);

    menuButtons(root, "more")
      .find((button) => button.dataset.formatCommand === "insert.table")!
      .click();
    await nextTick();
    expect(runs).toEqual(["insert.table"]);
    expect(root.querySelector('[data-format-menu="more"]')).toBeNull();
  });

  it("E3 R1: closes More and restores a reachable trigger when resize moves the focused item", async () => {
    let toolbarWidth = 200;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        if (this.hasAttribute("data-format-toolbar")) return rect(toolbarWidth);
        const key = this.getAttribute("data-measure-key");
        if (key === "__more") return rect(28);
        if (key === "paragraph") return rect(88);
        if (key !== null) return rect(28);
        return rect(0);
      },
    );
    const { root } = await mountToolbar();
    const more = root.querySelector<HTMLButtonElement>("[data-format-more]")!;
    more.focus();
    more.click();
    await nextTick();
    const link = menuButtons(root, "more").find(
      (button) => button.dataset.formatCommand === "format.link",
    )!;
    expect(document.activeElement).toBe(link);

    toolbarWidth = 500;
    window.dispatchEvent(new Event("resize"));
    await nextTick();
    await nextTick();

    expect(
      root.querySelector(
        '[data-format-row] [data-format-command="format.link"]',
      ),
    ).not.toBeNull();
    expect(root.querySelector('[data-format-menu="more"]')).toBeNull();
    expect(document.activeElement).toBe(
      root.querySelector("[data-format-more]"),
    );
  });

  it("keeps every control unavailable while composing", async () => {
    const { root, runs, disabled } = await mountToolbar({
      disabled: true,
    });
    const bold = root.querySelector<HTMLButtonElement>(
      '[data-format-command="format.bold"]',
    )!;
    const trigger = root.querySelector<HTMLButtonElement>(
      "[data-format-paragraph-trigger]",
    )!;
    expect(bold.disabled).toBe(true);
    expect(trigger.disabled).toBe(true);
    bold.click();
    trigger.click();
    await nextTick();
    expect(runs).toEqual([]);
    expect(root.querySelector('[data-format-menu="paragraph"]')).toBeNull();

    disabled.value = false;
    await nextTick();
    expect(
      root.querySelector<HTMLButtonElement>(
        '[data-format-command="format.bold"]',
      )!.disabled,
    ).toBe(false);
  });
});
