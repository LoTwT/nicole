import { createApp, defineComponent, h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/files", () => ({
  listDirectory: vi.fn().mockResolvedValue({ path: ".", entries: [] }),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  trashEntry: vi.fn(),
  openWithDefaultApp: vi.fn(),
  revealEntry: vi.fn(),
}));
vi.mock("../services/menu", () => ({ popupNativeMenu: vi.fn() }));
vi.mock("../services/clipboard", () => ({ copyText: vi.fn() }));

import { copyText } from "../services/clipboard";
import { listDirectory } from "../services/files";
import { popupNativeMenu } from "../services/menu";
import AppSidebar from "./AppSidebar.vue";

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 6; index++) await nextTick();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector<HTMLElement>("#app")!;
  vi.mocked(copyText).mockResolvedValue(true);
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mount(
  width = 252,
  platform: "macos" | "windows" | "linux" = "macos",
  initialExpanded: string[] = [],
) {
  const changes: number[] = [];
  const commits: number[] = [];
  let resets = 0;
  let themes = 0;
  let openFolders = 0;
  const runCommands: string[] = [];
  const expandedChanges: string[][] = [];
  const Component = defineComponent({
    setup() {
      return () =>
        h(AppSidebar, {
          width,
          mode: "pinned",
          platform,
          rootName: "notes",
          rootPath: "/tmp/notes",
          generation: 1,
          selectedPath: null,
          initialExpanded,
          isDark: false,
          onWidthChange: (value: number) => changes.push(value),
          onWidthCommit: (value: number) => commits.push(value),
          onResetWidth: () => {
            resets += 1;
          },
          onToggleTheme: () => {
            themes += 1;
          },
          onOpenFolder: () => {
            openFolders += 1;
          },
          onRunCommand: (id: string) => {
            runCommands.push(id);
          },
          onExpandedChange: (folders: string[]) => {
            expandedChanges.push(folders);
          },
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
  return {
    changes,
    commits,
    resets: () => resets,
    themes: () => themes,
    openFolders: () => openFolders,
    runCommands,
    expandedChanges,
  };
}

describe("AppSidebar", () => {
  it("drags the edge within 200-400 px and reports the committed width", async () => {
    const log = mount();
    await settle();
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!;
    handle.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 252,
        button: 0,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 320 }),
    );
    window.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, clientX: 620 }),
    );
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    expect(log.changes.at(-1)).toBe(400);
    expect(log.commits.at(-1)).toBe(400);
  });

  it("resets the width on double click and with the keyboard", async () => {
    const log = mount(300);
    await settle();
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!;
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(log.resets()).toBe(1);

    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(log.changes.at(-1)).toBe(290);
    expect(log.commits.at(-1)).toBe(290);
  });

  it("names icon-only controls", async () => {
    mount();
    await settle();
    expect(
      host.querySelector('button[aria-label^="隐藏侧栏"]'),
    ).not.toBeNull();
    expect(
      host.querySelector('button[aria-label^="设置"]'),
    ).not.toBeNull();
    const search = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="搜索工作区"]',
    );
    expect(search).not.toBeNull();
    expect(search!.querySelectorAll("kbd")).toHaveLength(0);
    expect(search!.textContent?.replace(/\s+/g, "")).toBe("搜索工作区");
    expect(search!.getAttribute("title")).toContain("⇧⌘F");
    expect(search!.getAttribute("aria-label")).toContain("⇧⌘F");
    expect(search!.disabled).toBe(true);
    expect(search!.className).toContain("disabled:opacity-50");
    const settings = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="设置"]',
    )!;
    expect(settings.disabled).toBe(true);
    expect(settings.className).toContain("disabled:opacity-50");
    expect(
      host.querySelector('button[aria-label="切换到暗色主题"]'),
    ).not.toBeNull();
  });

  it("keeps the platform shortcut only in the search tooltip", async () => {
    mount(252, "windows");
    await settle();
    const search = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="搜索工作区"]',
    )!;
    expect(search.querySelectorAll("kbd")).toHaveLength(0);
    expect(search.textContent?.replace(/\s+/g, "")).toBe("搜索工作区");
    expect(search.getAttribute("title")).toContain("Ctrl+Shift+F");
    expect(search.getAttribute("aria-label")).toContain("Ctrl+Shift+F");
  });

  it("switches folders from an icon-only footer button", async () => {
    const log = mount();
    await settle();
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label="切换文件夹 ⌘O"]',
    );
    expect(button).not.toBeNull();
    expect(button?.textContent?.trim()).toBe("");
    expect(button?.querySelector('svg[viewBox="0 0 24 24"]')).not.toBeNull();
    button!.click();
    expect(log.openFolders()).toBe(1);
  });

  it("toggles the theme from the sidebar footer", async () => {
    const log = mount();
    await settle();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="切换到暗色主题"]')!
      .click();
    expect(log.themes()).toBe(1);
  });
});

describe("workspace tool row", () => {
  it("shows the workspace name and four labelled icon buttons", async () => {
    mount();
    await settle();
    const tools = host.querySelector('[role="group"][aria-label="工作区操作"]')!;
    expect(tools.textContent).toContain("notes");
    const labels = [...tools.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "新建文件 ⌘N",
      "新建文件夹 ⇧⌘N",
      "全部折叠",
      "更多",
    ]);
  });

  it("does not steal focus when an empty root creation blurs", async () => {
    mount();
    await settle();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="新建文件 ⌘N"]')!
      .click();
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await settle();
    expect(document.activeElement).toBe(outside);
    expect(input.isConnected).toBe(false);
  });

  it("starts inline creation at the workspace root", async () => {
    mount();
    await settle();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="新建文件 ⌘N"]')!
      .click();
    await settle();
    expect(
      host.querySelector('input[aria-label="新建文件"]'),
    ).not.toBeNull();

    host
      .querySelector<HTMLButtonElement>('button[aria-label="新建文件夹 ⇧⌘N"]')!
      .click();
    await settle();
    expect(
      host.querySelector('input[aria-label="新建文件夹"]'),
    ).not.toBeNull();
  });

  it("runs commands from the more menu", async () => {
    vi.mocked(popupNativeMenu).mockResolvedValue("app.close-workspace");
    const log = mount();
    await settle();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="更多"]')!
      .click();
    await settle();
    expect(popupNativeMenu).toHaveBeenCalledOnce();
    const request = vi.mocked(popupNativeMenu).mock.calls[0]![0];
    expect(request.items.map((item) => item.label)).toEqual([
      "在 Finder 中显示",
      "复制路径",
      "",
      "关闭工作区",
    ]);
    expect(log.runCommands).toContain("app.close-workspace");
  });

  it("copies the workspace root from the more menu", async () => {
    vi.mocked(popupNativeMenu).mockResolvedValue("copy-workspace-path");
    const log = mount();
    await settle();
    host
      .querySelector<HTMLButtonElement>('button[aria-label="更多"]')!
      .click();
    await settle();
    expect(vi.mocked(copyText)).toHaveBeenCalledWith("/tmp/notes");
    expect(log.runCommands).toEqual([]);
  });

  it("returns focus to the new-file button when inline creation is cancelled", async () => {
    mount();
    await settle();
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="新建文件 ⌘N"]',
    )!;
    trigger.click();
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("collapse all", () => {
  it("collapses every folder and saves the empty expansion", async () => {
    vi.mocked(listDirectory).mockImplementation(async (path: string) => {
      if (path === ".") {
        return {
          path: ".",
          entries: [
            {
              name: "notes",
              path: "notes",
              isDir: true,
              isMarkdown: false,
              size: 0,
            },
          ],
        };
      }
      if (path === "notes") {
        return {
          path: "notes",
          entries: [
            {
              name: "a.md",
              path: "notes/a.md",
              isDir: false,
              isMarkdown: true,
              size: 10,
            },
          ],
        };
      }
      return { path, entries: [] };
    });
    const log = mount(252, "macos", ["notes"]);
    await settle();
    const folder = host.querySelector<HTMLElement>(
      '[data-tree-path="notes"]',
    )!;
    expect(folder.getAttribute("aria-expanded")).toBe("true");

    host
      .querySelector<HTMLButtonElement>('button[aria-label="全部折叠"]')!
      .click();
    await settle();
    expect(folder.getAttribute("aria-expanded")).toBe("false");
    expect(log.expandedChanges.at(-1)).toEqual([]);
  });
});
