import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import AppIcon from "./AppIcon.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("AppIcon", () => {
  it("renders every icon on the shared Lucide grid", () => {
    const names = [
      "sidebar",
      "search",
      "plus",
      "gear",
      "chevron-right",
      "chevron-down",
      "close",
      "folder",
      "folder-open",
      "file-text",
      "file",
      "file-plus",
      "folder-plus",
      "chevrons-down-up",
      "outline",
      "sun",
      "moon",
      "more",
      "live",
      "immersive",
      "source",
    ] as const;
    document.body.innerHTML = '<div id="app"></div>';
    app = createApp(
      defineComponent({
        render: () =>
          h(
            "div",
            names.map((name) =>
              h(AppIcon, { name, size: 16, "data-icon": name }),
            ),
          ),
      }),
    );
    app.mount("#app");

    const icons = [...document.querySelectorAll<SVGElement>("svg[data-icon]")];
    expect(icons).toHaveLength(names.length);
    for (const icon of icons) {
      expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(icon.getAttribute("stroke-width")).toBe("1.75");
      expect(icon.getAttribute("stroke")).toBe("currentColor");
      expect(icon.children.length).toBeGreaterThan(0);
    }
  });
});
