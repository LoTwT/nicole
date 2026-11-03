import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandPaletteMode } from "../app/command-palette";
import { getCommand } from "../commands/registry";
import type { DocumentHeading } from "../editor/headings";
import CommandPalette from "./CommandPalette.vue";

let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 20; index++) {
    await Promise.resolve();
    await nextTick();
  }
}

function paletteInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]');
  if (!input) throw new Error("palette input not found");
  return input;
}

function modeIndicator(): HTMLSpanElement | null {
  return document.querySelector<HTMLSpanElement>(
    '.command-palette-input-row span[aria-hidden="true"]',
  );
}

function options(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function mountPalette(options: {
  mode?: CommandPaletteMode;
  workspaceOpen?: boolean;
  headings?: DocumentHeading[];
  headingsTruncated?: boolean;
  recentFiles?: string[];
  recentCommandIds?: string[];
  loadFiles?: () => Promise<string[]>;
  hasMarkdown?: boolean;
  onRunCommand?: (id: string) => void;
  onClose?: () => void;
  onJump?: (position: number) => void;
  onOpenFile?: (path: string) => void;
}) {
  const host = document.createElement("div");
  host.innerHTML = '<button id="opener">open</button><div id="app"></div>';
  document.body.append(host);
  const opener = host.querySelector<HTMLButtonElement>("#opener")!;
  opener.focus();
  const open = ref(true);
  const Component = defineComponent({
    setup() {
      return () =>
        h("div", [
          h("button", { id: "opener" }, "open"),
          open.value
            ? h(CommandPalette, {
                mode: options.mode ?? "command",
                platform: "macos",
                commands: [
                  getCommand("format.bold")!,
                  getCommand("format.italic")!,
                ],
                workspaceOpen: options.workspaceOpen ?? false,
                recentFiles: options.recentFiles ?? [],
                recentCommandIds: options.recentCommandIds ?? [],
                headings: options.headings ?? [],
                headingsTruncated: options.headingsTruncated ?? false,
                hasMarkdown: options.hasMarkdown ?? false,
                loadFiles: options.loadFiles ?? (async () => []),
                onClose: () => {
                  options.onClose?.();
                  open.value = false;
                },
                onRunCommand: options.onRunCommand,
                onJumpHeading: options.onJump,
                onOpenFile: options.onOpenFile,
              })
            : null,
        ]);
    },
  });
  app = createApp(Component);
  app.mount(host.querySelector("#app")!);
  return { host, opener, close: () => (open.value = false) };
}

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("CommandPalette", () => {
  it("renders a combobox and listbox with an active option", async () => {
    mountPalette({ recentCommandIds: ["format.italic"] });
    await settle();

    const input = paletteInput();
    expect(input.value).toBe("");
    expect(modeIndicator()?.textContent?.trim()).toBe(">");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(document.activeElement).toBe(input);
    expect(options()[0]?.textContent).toContain("斜体");
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options()[0]?.id,
    );
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options()[0]?.tabIndex).toBe(-1);
    expect(options()[0]?.querySelector("kbd")?.textContent).toBe("⌘");
  });

  it("runs the selected command with Enter and leaves IME keys alone", async () => {
    const onRunCommand = vi.fn();
    const { close } = mountPalette({ onRunCommand });
    await settle();
    const input = paletteInput();

    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(composingEnter);
    expect(onRunCommand).not.toHaveBeenCalled();
    expect(composingEnter.defaultPrevented).toBe(false);

    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(onRunCommand).toHaveBeenCalledWith("format.bold");
    close();
    await settle();
  });

  it("switches modes from a prefix typed into an empty query", async () => {
    mountPalette({
      mode: "file",
      workspaceOpen: true,
      hasMarkdown: true,
      loadFiles: async () => ["a.md"],
      headings: [
        { level: 1, text: "标题一", position: 0, line: 1 },
        { level: 2, text: "标题二", position: 10, line: 3 },
      ],
    });
    await settle();
    const input = paletteInput();
    expect(input.value).toBe("");
    expect(modeIndicator()).toBeNull();

    type(input, "lite");
    await settle();
    expect(input.getAttribute("aria-label")).toContain("文件名");
    type(input, "lite>");
    await settle();
    expect(input.value).toBe("lite>");
    expect(modeIndicator()).toBeNull();

    type(input, "");
    await settle();
    type(input, ">");
    await settle();
    expect(input.value).toBe("");
    expect(modeIndicator()?.textContent?.trim()).toBe(">");
    expect(input.getAttribute("aria-label")).toContain("命令");

    type(input, "加粗");
    await settle();
    expect(options()[0]?.textContent).toContain("加粗");

    type(input, "");
    await settle();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(input.value).toBe("");
    expect(modeIndicator()).toBeNull();
    expect(input.getAttribute("aria-label")).toContain("文件名");

    type(input, "@");
    await settle();
    expect(input.value).toBe("");
    expect(modeIndicator()?.textContent?.trim()).toBe("@");
    expect(input.getAttribute("aria-label")).toContain("标题");
    expect(options()[0]?.textContent).toContain("标题一");
  });

  it("keeps a prefix as text when the query is not empty", async () => {
    mountPalette({
      mode: "file",
      workspaceOpen: true,
      loadFiles: async () => ["a.md"],
    });
    await settle();
    const input = paletteInput();

    type(input, "abc");
    await settle();
    input.setSelectionRange(0, 0);
    type(input, ">abc");
    await settle();
    expect(input.value).toBe(">abc");
    expect(modeIndicator()).toBeNull();
    expect(input.getAttribute("aria-label")).toContain("文件名");

    input.setSelectionRange(0, 0);
    type(input, "@abc");
    await settle();
    expect(input.value).toBe("@abc");
    expect(modeIndicator()).toBeNull();
    expect(input.getAttribute("aria-label")).toContain("文件名");
  });

  it("adopts a pasted prefix into an empty query", async () => {
    mountPalette({
      mode: "file",
      workspaceOpen: true,
      loadFiles: async () => ["a.md"],
    });
    await settle();
    const input = paletteInput();

    type(input, ">加粗");
    await settle();
    expect(input.value).toBe("加粗");
    expect(modeIndicator()?.textContent?.trim()).toBe(">");
    expect(options()[0]?.textContent).toContain("加粗");
  });

  it("does not switch on Backspace when the query is not empty", async () => {
    mountPalette({ mode: "command" });
    await settle();
    const input = paletteInput();

    type(input, "abc");
    await settle();
    input.setSelectionRange(1, 1);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(modeIndicator()?.textContent?.trim()).toBe(">");

    input.setSelectionRange(0, 2);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(modeIndicator()?.textContent?.trim()).toBe(">");
  });

  it("waits for composition to end before adopting a prefix", async () => {
    mountPalette({
      mode: "file",
      workspaceOpen: true,
      hasMarkdown: true,
      loadFiles: async () => ["a.md"],
      headings: [{ level: 1, text: "标题一", position: 0, line: 1 }],
    });
    await settle();
    const input = paletteInput();

    input.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    type(input, "@标题一");
    await settle();
    expect(modeIndicator()).toBeNull();
    expect(input.value).toBe("@标题一");

    input.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "@标题一",
      }),
    );
    await settle();
    expect(modeIndicator()?.textContent?.trim()).toBe("@");
    expect(input.value).toBe("标题一");
    expect(options()[0]?.textContent).toContain("标题一");
  });

  it("uses no shared focus ring on the palette input", async () => {
    mountPalette({});
    await settle();
    const input = paletteInput();

    expect(document.activeElement).toBe(input);
    expect(input.classList.contains("focus-ring")).toBe(false);
    expect(input.classList.contains("command-palette-input")).toBe(true);
  });

  it("puts recent files first and opens the selected file", async () => {
    const onOpenFile = vi.fn();
    mountPalette({
      mode: "file",
      workspaceOpen: true,
      recentFiles: ["notes/b.md"],
      loadFiles: async () => ["a.md", "notes/b.md"],
      onOpenFile,
    });
    await settle();
    const input = paletteInput();
    expect(input.value).toBe("");
    expect(options().map((item) => item.textContent)).toEqual([
      expect.stringContaining("b.md"),
      expect.stringContaining("a.md"),
    ]);

    options()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenFile).toHaveBeenCalledWith("notes/b.md");
  });

  it("shows the empty heading state and traps Tab in the input", async () => {
    mountPalette({ mode: "heading", hasMarkdown: false });
    await settle();
    const input = paletteInput();
    expect(document.body.textContent).toContain(
      "当前没有打开的 Markdown 文件",
    );

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(input);
    expect(document.body.textContent).toContain("当前没有打开的 Markdown 文件");
  });

  it("marks empty headings and reports a partial extraction", async () => {
    mountPalette({
      mode: "heading",
      hasMarkdown: true,
      headings: [{ level: 1, text: "", position: 0, line: 1 }],
      headingsTruncated: true,
    });
    await settle();

    const option = options()[0]!;
    expect(option.textContent).toContain("空标题");
    expect(option.querySelector(".block.truncate")?.className).toContain(
      "text-[var(--text-muted)]",
    );
    expect(document.body.textContent).toContain(
      "文档较大，部分标题尚未解析",
    );
  });

  it("keeps focus in the input when the panel background is pressed", async () => {
    mountPalette({});
    await settle();
    const input = paletteInput();
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;

    const mousedown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    panel.dispatchEvent(mousedown);
    await settle();

    expect(mousedown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("leaves mousedown on the input to the browser for caret placement", async () => {
    mountPalette({});
    await settle();
    const input = paletteInput();

    const mousedown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(mousedown);

    expect(mousedown.defaultPrevented).toBe(false);
  });

  it("closes on Escape and restores focus to the opener", async () => {
    const onClose = vi.fn();
    const { opener } = mountPalette({ onClose });
    await settle();
    paletteInput().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });
});
