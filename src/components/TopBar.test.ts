import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import TopBar, { type TopBarTab } from "./TopBar.vue";

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;
let scrollIntoView: ReturnType<typeof vi.fn>;

function tabs(count: number): TopBarTab[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `note-${index}.md`,
    suffix: null,
    title: `notes/note-${index}.md`,
    problem: null,
    problemLabel: "",
  }));
}

async function settle() {
  for (let index = 0; index < 6; index++) await nextTick();
}

function mount(
  tabList: TopBarTab[],
  activeTabId: number | null,
  showOutline = true,
  outline: { enabled: boolean; on: boolean } = { enabled: false, on: false },
) {
  const emitted: {
    activate: number[];
    close: number[];
    menu: [number, number, number][];
    outline: number;
  } = { activate: [], close: [], menu: [], outline: 0 };
  const Component = defineComponent({
    setup() {
      return () =>
        h(TopBar, {
          tabs: tabList,
          activeTabId,
          mode: "live",
          platform: "macos",
          compact: false,
          sidebarShown: true,
          showSidebarToggle: false,
          showOpenFolder: false,
          showOutline,
          outlineEnabled: outline.enabled,
          outlineOn: outline.on,
          onActivateTab: (id: number) => emitted.activate.push(id),
          onCloseTab: (id: number) => emitted.close.push(id),
          onTabMenu: (id: number, x: number, y: number) =>
            emitted.menu.push([id, x, y]),
          onSetMode: () => {},
          onToggleSidebar: () => {},
          onToggleOutline: () => {
            emitted.outline += 1;
          },
          onOpenFolder: () => {},
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
  return emitted;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector<HTMLElement>("#app")!;
  scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView =
    scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as { scrollIntoView?: unknown })
    .scrollIntoView;
});

describe("TopBar tabs", () => {
  it("keeps fifteen tabs in one horizontally scrollable list", async () => {
    mount(tabs(15), 15);
    await settle();

    const elements = host.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(elements.length).toBe(15);
    expect(elements[14]!.getAttribute("aria-selected")).toBe("true");
    expect(elements[0]!.getAttribute("tabindex")).toBe("-1");
    expect(
      host
        .querySelector('[role="tablist"]')
        ?.className.includes("overflow-x-auto"),
    ).toBe(true);
    expect(
      host.querySelector('[role="group"][aria-label="编辑模式"]'),
    ).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("keeps tabs out of text selection", async () => {
    mount(tabs(1), 1);
    await settle();
    expect(
      host.querySelector<HTMLElement>('[role="tab"]')?.classList.contains(
        "select-none",
      ),
    ).toBe(true);
  });

  it("moves focus with arrows and switches only on Enter or Space", async () => {
    const emitted = mount(tabs(3), 1);
    await settle();
    const elements = [
      ...host.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    elements[0]!.focus();
    elements[0]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(document.activeElement).toBe(elements[1]);
    expect(emitted.activate).toEqual([]);

    elements[1]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    elements[1]!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(emitted.activate).toEqual([2, 2]);
  });

  it("shows a close button only on the active or hovered tab", async () => {
    const emitted = mount(tabs(2), 2);
    await settle();
    const elements = [
      ...host.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    const closeActive = elements[1]!.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 note-1.md"]',
    );
    const closeInactive = elements[0]!.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 note-0.md"]',
    );
    expect(closeActive?.className).toContain("opacity-100");
    expect(closeInactive?.className).toContain("opacity-0");
    closeActive!.click();
    expect(emitted.close).toEqual([2]);
  });

  it("keeps active, hovered and idle tabs distinct", async () => {
    mount(tabs(3), 2);
    await settle();
    const elements = [
      ...host.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    const active = elements[1]!;
    const idle = elements[0]!;
    expect(active.className).toContain("bg-[var(--surface-muted)]");
    expect(active.className).toContain("text-[var(--text-primary)]");
    expect(active.className).not.toContain(
      "hover:bg-[var(--surface-subtle)]",
    );
    expect(idle.className).toContain("text-[var(--text-muted)]");
    expect(idle.className).toContain("hover:bg-[var(--surface-subtle)]");
    expect(idle.className).not.toContain("bg-[var(--surface-muted)]");

    const activeClose = active.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 note-1.md"]',
    );
    const idleClose = idle.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 note-0.md"]',
    );
    expect(activeClose?.className).toContain(
      "hover:bg-[var(--surface-subtle)]",
    );
    expect(idleClose?.className).toContain(
      "hover:bg-[var(--surface-muted)]",
    );
  });

  it("uses the problem dot as the close entry and explains the state", async () => {
    const list = tabs(1);
    list[0] = {
      ...list[0]!,
      problem: "danger",
      problemLabel: "保存失败",
    };
    const emitted = mount(list, 1);
    await settle();
    const dot = host.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 note-0.md：保存失败"]',
    );
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("保存失败");
    expect(dot?.className).toContain(
      "hover:bg-[var(--surface-subtle)]",
    );
    dot!.click();
    expect(emitted.close).toEqual([1]);
  });

  it("requests the native tab menu with the pointer position", async () => {
    const emitted = mount(tabs(1), 1);
    await settle();
    host
      .querySelector<HTMLElement>('[role="tab"]')!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 42,
          clientY: 17,
        }),
      );
    expect(emitted.menu).toEqual([[1, 42, 17]]);
  });

  it("reflects outline availability and pressed state", async () => {
    const disabledEmitted = mount([], null, true);
    await settle();
    let toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="显示或隐藏大纲"]',
    )!;
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("outline-panel");
    expect(toggle.title).not.toContain("后续版本");
    toggle.click();
    expect(disabledEmitted.outline).toBe(0);

    app?.unmount();
    app = null;
    const emitted = mount([], null, true, { enabled: true, on: true });
    await settle();
    toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="显示或隐藏大纲"]',
    )!;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.className).toContain("bg-[var(--surface-subtle)]");
    toggle.click();
    expect(emitted.outline).toBe(1);
  });

  it("hides the outline toggle when there is no workspace", async () => {
    mount([], null, false);
    await settle();
    expect(
      host.querySelector('button[aria-label^="显示或隐藏大纲"]'),
    ).toBeNull();

    app?.unmount();
    app = null;
    mount([], null, true);
    await settle();
    expect(
      host.querySelector('button[aria-label^="显示或隐藏大纲"]'),
    ).not.toBeNull();
  });
});
