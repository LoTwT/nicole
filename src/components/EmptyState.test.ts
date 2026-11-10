import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppPlatform } from "../app/platform";
import EmptyState from "./EmptyState.vue";

let app: ReturnType<typeof createApp> | null = null;

function unmountApp() {
  app?.unmount();
  app = null;
}

afterEach(() => {
  app?.unmount();
  app = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

interface MountOptions {
  mode?: "start" | "no-file";
  recentFolders?: string[];
  missingFolders?: string[];
  dropActive?: boolean;
}

function mount(
  platform: AppPlatform,
  options: MountOptions = {},
) {
  const calls = {
    quickOpen: 0,
    openRecent: [] as string[],
    removeRecent: [] as string[],
  };
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(EmptyState, {
          mode: options.mode ?? "no-file",
          recentFolders: options.recentFolders ?? [],
          missingFolders: options.missingFolders ?? [],
          missingLastFolder: null,
          homeDir: "/Users/test",
          platform,
          dropActive: options.dropActive ?? false,
          onQuickOpen: () => {
            calls.quickOpen += 1;
          },
          onOpenRecent: (path: string) => {
            calls.openRecent.push(path);
          },
          onRemoveRecent: (path: string) => {
            calls.removeRecent.push(path);
          },
        }),
    }),
  );
  app.mount("#app");
  return { host: document.querySelector<HTMLElement>("#app")!, calls };
}

function mountLive(
  platform: AppPlatform,
  initialFolders: string[],
  options: { markMissingOnOpen?: boolean } = {},
) {
  const state = reactive({
    folders: [...initialFolders],
    missing: [] as string[],
  });
  const calls = {
    openRecent: [] as string[],
    removeRecent: [] as string[],
  };
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(EmptyState, {
          mode: "start",
          recentFolders: state.folders,
          missingFolders: state.missing,
          missingLastFolder: null,
          homeDir: "/Users/test",
          platform,
          dropActive: false,
          onOpenRecent: (path: string) => {
            calls.openRecent.push(path);
            if (options.markMissingOnOpen === true) {
              state.missing = [...state.missing, path];
            }
          },
          onRemoveRecent: (path: string) => {
            calls.removeRecent.push(path);
            state.folders = state.folders.filter((folder) => folder !== path);
          },
        }),
    }),
  );
  app.mount("#app");
  return {
    host: document.querySelector<HTMLElement>("#app")!,
    calls,
    state,
  };
}

async function flush() {
  for (let index = 0; index < 8; index++) {
    await nextTick();
  }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.replace(/\s+/g, "") === label,
  );
  if (!found) throw new Error(`button ${label} not found`);
  return found;
}

describe("EmptyState", () => {
  it("renders quick open and new file as outlined secondary buttons", () => {
    const { host, calls } = mount("macos");
    const quick = button(host, "快速打开");
    expect(quick.querySelector("kbd")).toBeNull();
    expect(quick.textContent?.trim()).toBe("快速打开");
    expect(quick.getAttribute("aria-label")).toBe("快速打开 ⌘P");
    expect(quick.getAttribute("title")).toBe("快速打开 ⌘P");
    expect(quick.querySelector("svg")).not.toBeNull();
    expect(quick.className).toContain("button-secondary");
    expect(quick.className).toContain("border");
    expect(quick.className).toContain("px-[14px]");
    expect(quick.className).toContain("py-[7px]");
    expect(quick.querySelector("svg")!.getAttribute("class")).toContain(
      "text-[var(--text-secondary)]",
    );
    quick.click();
    expect(calls.quickOpen).toBe(1);

    const newFile = button(host, "新建文件");
    expect(newFile.textContent?.trim()).toBe("新建文件");
    expect(newFile.getAttribute("aria-label")).toBe("新建文件 ⌘N");
    expect(newFile.getAttribute("title")).toBe("新建文件 ⌘N");
    expect(newFile.querySelector("svg")).not.toBeNull();
    expect(newFile.className).toContain("button-secondary");
    expect(host.querySelectorAll("kbd")).toHaveLength(0);
  });

  it("uses the platform shortcut text for screen readers", () => {
    const { host } = mount("windows");
    expect(button(host, "快速打开").getAttribute("aria-label")).toBe(
      "快速打开 Ctrl+P",
    );
    expect(button(host, "新建文件").getAttribute("aria-label")).toBe(
      "新建文件 Ctrl+N",
    );
  });

  it("keeps the primary open-folder button text-only with a shortcut label", () => {
    const { host } = mount("macos", { mode: "start" });
    const primary = button(host, "打开文件夹");
    expect(primary.querySelector("kbd")).toBeNull();
    expect(primary.getAttribute("aria-label")).toBe("打开文件夹 ⌘O");
    expect(primary.getAttribute("title")).toBe("打开文件夹 ⌘O");
    expect(primary.className).toContain("button-primary");
    expect(primary.className).not.toContain("border-[var(--accent-primary)]");
  });

  it("shows at most five recent folders as name-only capsules", () => {
    const folders = [
      "/Users/test/one",
      "/Users/test/two",
      "/Users/test/three",
      "/Users/test/four",
      "/Users/test/five",
      "/Users/test/six",
      "/Users/test/seven",
    ];
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: folders,
    });
    const capsules = [...host.querySelectorAll("[data-recent-item]")];
    expect(capsules).toHaveLength(5);
    expect(capsules[0]?.textContent).toContain("one");
    expect(capsules[4]?.textContent).toContain("five");
    expect(host.textContent).not.toContain("six");
    expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(5);
    expect(
      [...host.querySelectorAll('[data-recent-item] button[aria-label^="打开 "]')]
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "打开 one（~/one）",
      "打开 two（~/two）",
      "打开 three（~/three）",
      "打开 four（~/four）",
      "打开 five（~/five）",
    ]);
  });

  it("keeps paths out of the label and puts them in the tooltip and accessible name", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: ["/Users/test/Notes"],
    });
    const open = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 Notes（~/Notes）"]',
    )!;
    expect(open.textContent?.replace(/\s+/g, "")).toBe("Notes");
    expect(open.getAttribute("title")).toBe("~/Notes");
    expect(open.closest("[data-recent-item]")?.getAttribute("title")).toBe(
      "~/Notes",
    );
    expect(host.textContent).not.toContain("~/Notes");
  });

  it("uses the shared suffix logic for duplicate folder names", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: [
        "/Users/test/Dropbox/notes",
        "/Users/test/Drive/notes",
      ],
    });
    const open = [...host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="打开 notes"]',
    )];
    expect(open).toHaveLength(2);
    expect(host.textContent).toContain("notes");
    expect(host.textContent).toContain("· Dropbox");
    expect(host.textContent).toContain("· Drive");
  });

  it("keeps a missing capsule retryable with a remove button", () => {
    const { host, calls } = mount("macos", {
      mode: "start",
      recentFolders: ["/Users/test/Gone"],
      missingFolders: ["/Users/test/Gone"],
    });
    const open = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 Gone（~/Gone），已不存在，点击重试"]',
    )!;
    expect(open.disabled).toBe(false);
    expect(open.getAttribute("title")).toBe("~/Gone（已不存在，点击重试）");
    expect(host.textContent).not.toContain("已不存在");
    open.click();
    expect(calls.openRecent).toEqual(["/Users/test/Gone"]);

    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="从最近打开中移除 Gone（已不存在）"]',
    )!;
    const item = remove.closest("[data-recent-item]")!;
    const capsule = item.querySelector("[data-recent-capsule]")!;
    expect(remove.className).toContain("opacity-100");
    expect(remove.className).toContain("absolute");
    expect(item.className).not.toContain("opacity-60");
    expect(capsule.className).toContain("opacity-60");
    expect(capsule.className).toContain("border");
    expect(capsule.className).toContain("border-[var(--border-default)]");
    for (
      let ancestor = remove.parentElement;
      ancestor !== null;
      ancestor = ancestor.parentElement
    ) {
      expect(ancestor.className).not.toContain("opacity-60");
    }
    remove.click();
    expect(calls.removeRecent).toEqual(["/Users/test/Gone"]);
    expect(calls.openRecent).toEqual(["/Users/test/Gone"]);
  });

  it("removes a recent folder from the capsule action", () => {
    const { host, calls } = mount("macos", {
      mode: "start",
      recentFolders: ["/Users/test/Notes"],
    });
    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="从最近打开中移除 Notes"]',
    )!;
    expect(remove.className).toContain("opacity-0");
    expect(remove.className).toContain("group-focus-within:opacity-100");
    expect(remove.className).toContain("size-6");
    expect(remove.className).toContain("-right-2");
    expect(remove.className).toContain("-top-2");
    expect(remove.className).toContain("group/remove");
    expect(remove.className).toContain("focus-ring");
    const circle = remove.querySelector("span")!;
    expect(circle.className).toContain("size-4");
    expect(circle.className).toContain("transition-colors");
    expect(circle.className).toContain("border-[var(--border-default)]");
    expect(circle.className).not.toContain("border-[var(--text-primary)]");
    for (const state of ["hover", "active", "focus-visible"]) {
      expect(circle.className).toContain(
        `group-${state}/remove:bg-[var(--surface-muted)]`,
      );
      expect(circle.className).toContain(
        `group-${state}/remove:text-[var(--text-primary)]`,
      );
    }
    const item = remove.closest("[data-recent-item]")!;
    const capsule = item.querySelector("[data-recent-capsule]")!;
    expect(item.className).not.toContain("hover:bg-[var(--surface-subtle)]");
    expect(capsule.className).toContain("hover:bg-[var(--surface-subtle)]");
    const open = host.querySelector<HTMLButtonElement>(
      "[data-recent-item] button[aria-label^='打开 ']",
    )!;
    expect(open.className).not.toContain("pr-8");
    expect(open.className).toContain("px-4");
    remove.click();
    expect(calls.removeRecent).toEqual(["/Users/test/Notes"]);
    expect(calls.openRecent).toEqual([]);
  });

  it("shows the path when a root folder has no basename", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: ["/"],
    });
    const open = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 /（/）"]',
    )!;
    expect(open.textContent?.trim()).toBe("/");
  });

  it("normalizes Windows paths for names and suffixes", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: [
        "C:\\Users\\me\\Dropbox\\notes",
        "C:\\Users\\me\\Drive\\notes",
      ],
    });
    expect(host.textContent).toContain("notes");
    expect(host.textContent).toContain("· Dropbox");
    expect(host.textContent).toContain("· Drive");
  });

  it("keeps the name visible when the disambiguating suffix is long", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: [
        "/Users/test/a-very-long-parent-directory-name-for-this-folder/notes",
        "/Users/test/other/notes",
      ],
    });
    const open = [...host.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="打开 notes"]',
    )];
    expect(open).toHaveLength(2);
    const name = open[0]!.querySelector<HTMLElement>("span")!;
    const suffix = open[0]!.querySelectorAll<HTMLElement>("span")[1]!;
    expect(name.className).toContain("flex-1");
    expect(name.className).toContain("min-w-0");
    expect(suffix.className).toContain("max-w-[80px]");
    expect(suffix.className).toContain("truncate");
  });

  it("uses the suffix and missing state in the remove accessible name", () => {
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: [
        "/Users/test/Dropbox/notes",
        "/Users/test/Drive/notes",
      ],
      missingFolders: ["/Users/test/Drive/notes"],
    });
    expect(
      host.querySelector(
        'button[aria-label="从最近打开中移除 notes · Drive（已不存在）"]',
      ),
    ).not.toBeNull();
    expect(
      host.querySelector('[data-recent-item] span.line-through'),
    ).not.toBeNull();
  });

  it("moves focus to the next, previous, or open-folder button after removal", async () => {
    const first = mountLive("macos", ["/a", "/b", "/c"]);
    await flush();
    first.host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="从最近打开中移除 b"]',
      )!
      .click();
    await flush();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "打开 c（/c）",
    );

    unmountApp();
    const last = mountLive("macos", ["/a", "/b", "/c"]);
    await flush();
    last.host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="从最近打开中移除 c"]',
      )!
      .click();
    await flush();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "打开 b（/b）",
    );

    unmountApp();
    const only = mountLive("macos", ["/a"]);
    await flush();
    only.host
      .querySelector<HTMLButtonElement>(
        'button[aria-label="从最近打开中移除 a"]',
      )!
      .click();
    await flush();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "打开文件夹 ⌘O",
    );
  });

  it("keeps the capsule DOM and focus when it becomes missing", async () => {
    const live = mountLive("macos", ["/Users/test/notes"], {
      markMissingOnOpen: true,
    });
    await flush();
    const open = live.host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 notes（~/notes）"]',
    )!;
    const capsule = open.closest("[data-recent-item]")!;
    open.focus();
    open.click();
    await flush();
    expect(open.disabled).toBe(false);
    expect(open.isConnected).toBe(true);
    expect(capsule.isConnected).toBe(true);
    expect(capsule.querySelector("span.line-through")).not.toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "打开 notes（~/notes），已不存在，点击重试",
    );
  });

  it("does not move focus when unrelated recent items change", async () => {
    const live = mountLive("macos", ["/a", "/b"]);
    await flush();
    const open = live.host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 a（/a）"]',
    )!;
    open.focus();
    live.state.folders = ["/a", "/b", "/c"];
    await flush();
    expect(document.activeElement).toBe(open);
  });

  it("uses actual measured widths, reflows on resize, and disconnects the observer", async () => {
    class FakeResizeObserver {
      static instances: FakeResizeObserver[] = [];
      readonly observed = new Set<Element>();
      disconnected = false;
      constructor(readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this);
      }
      observe(element: Element) {
        this.observed.add(element);
      }
      unobserve(element: Element) {
        this.observed.delete(element);
      }
      disconnect() {
        this.disconnected = true;
        this.observed.clear();
      }
      trigger() {
        this.callback([], this as unknown as ResizeObserver);
      }
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: ["/a", "/b", "/c", "/d", "/e"],
    });
    await flush();
    const list = host.querySelector<HTMLElement>('[role="list"]')!;
    let width = 420;
    Object.defineProperty(list, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    const capsules = [...list.querySelectorAll<HTMLElement>("[data-recent-item]")];
    for (const capsule of capsules) {
      Object.defineProperty(capsule, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ width: 100 }) as DOMRect,
      });
    }
    const observer = FakeResizeObserver.instances.find(
      (item) => item.observed.size > 0,
    )!;
    observer.trigger();
    await flush();
    expect(list.querySelectorAll(".basis-full")).toHaveLength(1);
    const firstCapsule = capsules[0]!;

    width = 220;
    observer.trigger();
    await flush();
    expect(list.querySelectorAll(".basis-full")).toHaveLength(2);
    expect(firstCapsule.isConnected).toBe(true);

    unmountApp();
    expect(observer.disconnected).toBe(true);
    vi.unstubAllGlobals();
  });

  it("hides the recent block when there is no history", () => {
    const { host } = mount("macos", { mode: "start" });
    expect(host.textContent).not.toContain("最近打开");
  });

  it("shows the drop hint only while a drop is active", () => {
    const { host } = mount("macos", { mode: "start", dropActive: true });
    const hint = host.querySelector("[data-drop-hint]");
    expect(hint?.className).toContain(
      "border-[var(--nicole-primary-fill)]",
    );
    expect(hint?.className).toContain("bg-[var(--surface-canvas)]");
    expect(
      hint?.querySelector("[data-drop-hint-tint]")?.className,
    ).toContain("bg-[var(--accent-soft)]/40");
    expect(hint?.textContent).toContain("松开以打开文件夹");
    const { host: idle } = (() => {
      app?.unmount();
      return mount("macos", { mode: "start" });
    })();
    expect(idle.querySelector("[data-drop-hint]")).toBeNull();
  });
});
