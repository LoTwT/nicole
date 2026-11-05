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
  const calls = { quickOpen: 0, openRecent: [] as string[] };
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

  it("shows at most five recent folders while keeping the missing marker", () => {
    const folders = ["/a", "/b", "/c", "/d", "/e", "/f", "/g"];
    const { host } = mount("macos", {
      mode: "start",
      recentFolders: folders,
      missingFolders: ["/c"],
    });
    const rows = [...host.querySelectorAll("li")];
    expect(rows).toHaveLength(5);
    expect(host.textContent).toContain("a");
    expect(host.textContent).toContain("e");
    expect(host.textContent).not.toContain("/f");
    expect(rows[2]?.textContent).toContain("已不存在");
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
