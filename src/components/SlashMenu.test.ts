import { createApp, defineComponent, h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SlashMenuState } from "../editor/slash";
import SlashMenu from "./SlashMenu.vue";

let app: ReturnType<typeof createApp> | null = null;

const state: SlashMenuState = {
  trigger: "/",
  query: "bi",
  anchor: { left: 120, top: 200, bottom: 220 },
  selectedIndex: 0,
  loading: false,
  items: [
    {
      id: "format.heading-1",
      label: "标题 1",
      glyph: "H1",
      shortcut: "⌘1",
    },
    {
      id: "insert.table",
      label: "表格",
      glyph: "▦",
      shortcut: "⌘2",
    },
  ],
};

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("SlashMenu", () => {
  it("renders the query, glyphs, labels and key hints without taking focus", () => {
    const onSelect = vi.fn();
    const onHighlight = vi.fn();
    document.body.innerHTML = '<div id="app"></div>';
    app = createApp(
      defineComponent({
        render: () =>
          h(SlashMenu, {
            state,
            onSelect,
            onHighlight,
          }),
      }),
    );
    app.mount("#app");

    expect(document.body.textContent).toContain("/bi");
    expect(document.body.textContent).toContain("标题 1");
    expect(document.body.textContent).toContain("表格");
    expect(document.body.textContent).toContain("⌘1");

    const options = [
      ...document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ];
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.className).toContain(
      "bg-[var(--nicole-selected-row)]",
    );
    expect(options[0]?.querySelector("span.text-right")?.className).toContain(
      "text-[var(--text-secondary)]",
    );
    expect(options[1]?.querySelector("span.text-right")?.className).toContain(
      "text-[var(--text-muted)]",
    );
    expect(
      options[1]?.querySelector("span.text-right")?.className,
    ).not.toContain("text-[var(--text-secondary)]");
    expect(options[0]?.getAttribute("aria-label")).toBe("标题 1 ⌘1");
    expect(options[0]?.tabIndex).toBe(-1);

    options[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("shows a non-executable loading row while templates load", () => {
    document.body.innerHTML = '<div id="app"></div>';
    app = createApp(
      defineComponent({
        render: () =>
          h(SlashMenu, {
            state: {
              ...state,
              query: "letter",
              items: [],
              loading: true,
            },
          }),
      }),
    );
    app.mount("#app");

    expect(document.body.textContent).toContain("/letter");
    expect(document.body.textContent).toContain("正在读取用户模板");
    expect(
      document.querySelectorAll('[role="option"]'),
    ).toHaveLength(0);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "正在读取用户模板",
    );
  });
});
