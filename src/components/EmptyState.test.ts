import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import type { AppPlatform } from "../app/platform";
import EmptyState from "./EmptyState.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
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
    expect(quick.className).toContain("border-[var(--border-default)]");
    expect(quick.className).toContain("bg-[var(--surface-elevated)]");
    expect(quick.className).toContain("text-[var(--text-primary)]");
    expect(quick.className).toContain("px-[14px]");
    expect(quick.className).toContain("py-[7px]");
    quick.click();
    expect(calls.quickOpen).toBe(1);

    const newFile = button(host, "新建文件");
    expect(newFile.textContent?.trim()).toBe("新建文件");
    expect(newFile.getAttribute("aria-label")).toBe("新建文件 ⌘N");
    expect(newFile.getAttribute("title")).toBe("新建文件 ⌘N");
    expect(newFile.querySelector("svg")).not.toBeNull();
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

  it("keeps a missing capsule unopenable with a remove button", () => {
    const { host, calls } = mount("macos", {
      mode: "start",
      recentFolders: ["/Users/test/Gone"],
      missingFolders: ["/Users/test/Gone"],
    });
    const open = host.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 Gone（~/Gone），已不存在"]',
    )!;
    expect(open.disabled).toBe(true);
    expect(open.getAttribute("title")).toBe("~/Gone（已不存在）");
    expect(host.textContent).not.toContain("已不存在");
    open.click();
    expect(calls.openRecent).toEqual([]);

    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="从最近打开中移除 Gone"]',
    )!;
    expect(remove.className).toContain("opacity-100");
    expect(remove.className).toContain("absolute");
    remove.click();
    expect(calls.removeRecent).toEqual(["/Users/test/Gone"]);
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
    expect(
      host.querySelector("[data-recent-item] button[aria-label^='打开 ']")!
        .className,
    ).toContain("pr-8");
    remove.click();
    expect(calls.removeRecent).toEqual(["/Users/test/Notes"]);
  });

  it("hides the recent block when there is no history", () => {
    const { host } = mount("macos", { mode: "start" });
    expect(host.textContent).not.toContain("最近打开");
  });

  it("shows the drop hint only while a drop is active", () => {
    const { host } = mount("macos", { mode: "start", dropActive: true });
    expect(host.querySelector("[data-drop-hint]")?.textContent).toContain(
      "松开以打开文件夹",
    );
    const { host: idle } = (() => {
      app?.unmount();
      return mount("macos", { mode: "start" });
    })();
    expect(idle.querySelector("[data-drop-hint]")).toBeNull();
  });
});
