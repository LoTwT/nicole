import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import KeyHint from "./KeyHint.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mount(shortcut: string) {
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () => h(KeyHint, { shortcut }),
    }),
  );
  app.mount("#app");
  return [
    ...document.querySelectorAll<HTMLElement>("#app kbd"),
  ];
}

describe("KeyHint", () => {
  it("renders each macOS shortcut key as an aligned keycap", () => {
    const keys = mount("⇧⌘F");
    expect(keys.map((key) => key.textContent?.trim())).toEqual(["⇧", "⌘", "F"]);
    for (const key of keys) {
      expect(key.classList).toContain("h-[18px]");
      expect(key.classList).toContain("min-w-[18px]");
      expect(key.classList).toContain("text-[10px]");
      expect(key.classList).toContain("font-medium");
      expect(key.classList).toContain("leading-none");
      expect(key.classList).toContain("font-sans");
    }
  });

  it("uses the Windows and Linux key names from the platform shortcut", () => {
    expect(mount("Ctrl+Shift+F").map((key) => key.textContent?.trim())).toEqual([
      "Ctrl",
      "Shift",
      "F",
    ]);
  });

  it("keeps a named key together", () => {
    expect(mount("F2").map((key) => key.textContent?.trim())).toEqual(["F2"]);
    expect(mount("⌘⌫").map((key) => key.textContent?.trim())).toEqual([
      "⌘",
      "⌫",
    ]);
  });
});
