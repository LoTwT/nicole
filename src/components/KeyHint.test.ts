import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import KeyHint from "./KeyHint.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mount(
  shortcut: string,
  variant?: "keycap" | "plain",
) {
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () => h(KeyHint, { shortcut, variant }),
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
      expect(key.classList).toContain("border");
      expect(key.classList).toContain("bg-[var(--surface-canvas)]");
      expect(key.classList).toContain("text-[var(--text-secondary)]");
      expect(key.className).toContain(
        "shadow-[inset_0_-1px_0_var(--border-subtle)]",
      );
    }
  });

  it("renders a plain shortcut without keycap chrome", () => {
    expect(mount("⇧⌘F", "plain")).toHaveLength(0);
    const hint = document.querySelector<HTMLElement>("#app > span")!;
    expect(hint.textContent?.trim()).toBe("⇧⌘F");
    expect(hint.className).toContain("font-sans");
    expect(hint.className).toContain("text-[11px]");
    expect(hint.className).toContain("text-[var(--text-muted)]");
    expect(hint.className).not.toContain("border");
    expect(hint.className).not.toContain("bg-[");
    expect(hint.className).not.toContain("shadow-[");
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
