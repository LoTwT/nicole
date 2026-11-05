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

function mount(platform: AppPlatform, mode: "start" | "no-file" = "no-file") {
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(EmptyState, {
          mode,
          recentFolders: [],
          missingFolders: [],
          missingLastFolder: null,
          homeDir: "/Users/test",
          platform,
        }),
    }),
  );
  app.mount("#app");
  return document.querySelector<HTMLElement>("#app")!;
}

function quickOpenRow(host: HTMLElement): HTMLElement {
  const row = [...host.querySelectorAll<HTMLElement>("span")].find((item) =>
    item.textContent?.includes("快速打开"),
  );
  if (!row) throw new Error("quick-open row not found");
  return row;
}

describe("EmptyState", () => {
  it("exposes the quick-open shortcut to screen readers", () => {
    const row = quickOpenRow(mount("macos"));
    expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(row.querySelector(".sr-only")?.textContent?.trim()).toBe("⌘P");
    expect(row.textContent?.replace(/\s+/g, "")).toContain("快速打开⌘P");
  });

  it("uses the platform shortcut text for screen readers", () => {
    expect(
      quickOpenRow(mount("windows")).querySelector(".sr-only")?.textContent?.trim(),
    ).toBe("Ctrl+P");
  });

  it("keeps keycaps for the temporary empty-state shortcuts", () => {
    const row = quickOpenRow(mount("macos"));
    const keys = [...row.querySelectorAll("kbd")];
    expect(keys.map((key) => key.textContent?.trim())).toEqual(["⌘", "P"]);
    for (const key of keys) {
      expect(key.classList).toContain("border");
      expect(key.classList).toContain("bg-[var(--surface-canvas)]");
    }
  });

  it("uses an on-accent keycap in the primary button", () => {
    const host = mount("macos", "start");
    const primary = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("打开文件夹"),
    );
    expect(primary).not.toBeUndefined();
    const keys = [...primary!.querySelectorAll("kbd")];
    expect(keys.map((key) => key.textContent?.trim())).toEqual(["⌘", "O"]);
    for (const key of keys) {
      expect(key.classList).toContain(
        "bg-[color-mix(in_srgb,currentColor_14%,transparent)]",
      );
      expect(key.classList).toContain("text-inherit");
      expect(
        [...key.classList].some(
          (name) => name === "border" || name.startsWith("border-"),
        ),
      ).toBe(false);
      expect(key.className).not.toContain("shadow-[");
    }
  });
});
