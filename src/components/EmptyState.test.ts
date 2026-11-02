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

function mount(platform: AppPlatform) {
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(EmptyState, {
          mode: "no-file",
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
});
