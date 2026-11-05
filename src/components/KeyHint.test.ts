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
  return document.querySelector<HTMLElement>("#app > span")!;
}

describe("KeyHint", () => {
  it("renders a plain shortcut without keycap chrome", () => {
    const hint = mount("⇧⌘F");
    expect(hint.textContent?.trim()).toBe("⇧⌘F");
    expect(hint.querySelectorAll("kbd")).toHaveLength(0);
    expect(hint.className).toContain("font-sans");
    expect(hint.className).toContain("text-[11px]");
    expect(hint.className).toContain("text-[var(--text-muted)]");
    expect(hint.className).toContain("text-right");
    expect(hint.className).not.toContain("border");
    expect(hint.className).not.toContain("bg-[");
    expect(hint.className).not.toContain("shadow-[");
  });

  it("keeps the platform shortcut text as one string", () => {
    expect(mount("Ctrl+Shift+F").textContent?.trim()).toBe("Ctrl+Shift+F");
  });
});
