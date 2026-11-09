import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import StatusBar from "./StatusBar.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function mount(showThemeToggle: boolean, isDark = false) {
  const onToggle = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(StatusBar, {
          saveStatus: null,
          notice: null,
          showThemeToggle,
          isDark,
          onToggleTheme: onToggle,
        }),
    }),
  );
  app.mount("#app");
  return { host: document.querySelector<HTMLElement>("#app")!, onToggle };
}

describe("StatusBar", () => {
  it("puts the fallback theme toggle in the bottom row below the divider", () => {
    const { host, onToggle } = mount(true);
    const footer = host.querySelector("footer")!;
    const theme = footer.querySelector<HTMLButtonElement>(
      'button[aria-label="切换到暗色主题"]',
    );
    expect(theme).not.toBeNull();
    expect(theme!.className).toContain("size-6");
    theme!.click();
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("follows the current theme label and hides the toggle elsewhere", () => {
    const { host: dark } = mount(true, true);
    expect(
      dark.querySelector('button[aria-label="切换到亮色主题"]'),
    ).not.toBeNull();
    app?.unmount();
    const { host } = mount(false);
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps the toggle from squeezing or overlapping status text", () => {
    const { host } = mount(true);
    const footer = host.querySelector("footer")!;
    const toggleRow = footer.querySelector<HTMLElement>("div")!;
    const statusRow = footer.querySelector<HTMLElement>("span")!;
    expect(toggleRow.className).toContain("shrink-0");
    expect(statusRow.className).toContain("min-w-0");
    expect(statusRow.className).toContain("flex-1");
  });
});
