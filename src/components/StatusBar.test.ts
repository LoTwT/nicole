import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SaveStatusPresentation } from "../app/status";
import StatusBar from "./StatusBar.vue";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

interface MountOptions {
  isDark?: boolean;
  saveStatus?: SaveStatusPresentation | null;
  notice?: string | null;
  noticeTone?: "success" | "danger" | "muted";
  noticeDetail?: string;
}

function mount(
  showThemeToggle: boolean,
  options: MountOptions = {},
) {
  const onToggle = vi.fn();
  document.body.innerHTML = '<div id="app"></div>';
  app = createApp(
    defineComponent({
      render: () =>
        h(StatusBar, {
          saveStatus: options.saveStatus ?? null,
          notice: options.notice ?? null,
          noticeTone: options.noticeTone,
          noticeDetail: options.noticeDetail,
          showThemeToggle,
          isDark: options.isDark ?? false,
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
    const { host: dark } = mount(true, { isDark: true });
    expect(
      dark.querySelector('button[aria-label="切换到亮色主题"]'),
    ).not.toBeNull();
    app?.unmount();
    const { host } = mount(false);
    expect(host.querySelector("button")).toBeNull();
  });

  it("right-aligns save status after the theme toggle", () => {
    const { host } = mount(true, {
      saveStatus: { label: "已保存", tone: "success" },
    });
    const footer = host.querySelector("footer")!;
    const [toggleRow, statusRow] = [...footer.children] as HTMLElement[];
    expect(toggleRow!.querySelector("button")).not.toBeNull();
    expect(statusRow!.className).toContain("ml-auto");
    expect(statusRow!.className).toContain("justify-end");
    expect(statusRow!.className).toContain("-mr-1.5");
    expect(statusRow!.className).toContain("flex-1");
    expect(statusRow!.className).toContain("min-w-0");
    expect(statusRow!.textContent?.trim()).toBe("已保存");

    const dot = statusRow!.querySelector<HTMLElement>("span")!;
    const label = dot.nextElementSibling as HTMLElement;
    expect(dot.className).toContain("size-[7px]");
    expect(dot.className).toContain("shrink-0");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
  });

  it("right-aligns status when the sidebar owns the theme toggle", () => {
    const { host } = mount(false, {
      saveStatus: { label: "已保存", tone: "success" },
    });
    const footer = host.querySelector("footer")!;
    const statusRow = footer.firstElementChild as HTMLElement;
    expect(statusRow.tagName).toBe("SPAN");
    expect(statusRow.className).toContain("justify-end");
    expect(statusRow.textContent?.trim()).toBe("已保存");
  });

  it("keeps long notices truncated with their tooltip", () => {
    const { host } = mount(true, {
      notice: "已载入磁盘上的新内容，但还有更多文字用于测试截断",
      noticeDetail: "raw backend error",
    });
    const statusRow = host.querySelector("footer > span")!;
    const label = statusRow.querySelector<HTMLElement>("span[title]")!;
    expect(label.textContent).toContain("已载入磁盘上的新内容");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("min-w-0");
    expect(label.getAttribute("title")).toBe("raw backend error");
  });

  it("keeps the toggle from squeezing or overlapping status text", () => {
    const { host } = mount(true);
    const footer = host.querySelector("footer")!;
    const toggleRow = footer.querySelector<HTMLElement>("div")!;
    const statusRow = footer.querySelector<HTMLElement>("span")!;
    expect(toggleRow.className).toContain("shrink-0");
    expect(statusRow.className).toContain("min-w-0");
    expect(statusRow.className).toContain("flex-1");
    expect(statusRow.className).toContain("justify-end");
  });
});
