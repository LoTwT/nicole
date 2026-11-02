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

import AppSidebar from "./AppSidebar.vue";

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 6; index++) await nextTick();
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

function mount(width = 252) {
  const changes: number[] = [];
  const commits: number[] = [];
  let resets = 0;
  const Component = defineComponent({
    setup() {
      return () =>
        h(AppSidebar, {
          width,
          mode: "pinned",
          platform: "macos",
          rootName: "notes",
          rootPath: "/tmp/notes",
          rootDisplayPath: "~/notes",
          generation: 1,
          selectedPath: null,
          initialExpanded: [],
          onWidthChange: (value: number) => changes.push(value),
          onWidthCommit: (value: number) => commits.push(value),
          onResetWidth: () => {
            resets += 1;
          },
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
  return { changes, commits, resets: () => resets };
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
    expect(
      host.querySelector('button[aria-label^="搜索全部文件夹"]'),
    ).not.toBeNull();
  });
});
