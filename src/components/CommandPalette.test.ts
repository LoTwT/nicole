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
    expect(input.value).toBe(">");
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

  it("switches modes when the prefix is deleted or rewritten", async () => {
    mountPalette({
      workspaceOpen: false,
      hasMarkdown: true,
      headings: [
        { level: 1, text: "标题一", position: 0, line: 1 },
        { level: 2, text: "标题二", position: 10, line: 3 },
      ],
    });
    await settle();
    const input = paletteInput();

    type(input, "lite");
    await settle();
    expect(paletteInput().getAttribute("aria-label")).toContain("文件名");
    expect(options().length).toBe(0);
    expect(document.body.textContent).toContain("先打开一个文件夹");

    type(paletteInput(), "@标题二");
    await settle();
    expect(paletteInput().getAttribute("aria-label")).toContain("标题");
    expect(options()[0]?.textContent).toContain("标题二");
    expect(options()[0]?.getAttribute("style")).toContain("padding-left: 20px");

    type(paletteInput(), ">加粗");
    await settle();
    expect(paletteInput().value).toBe(">加粗");
    expect(options()[0]?.textContent).toContain("加粗");
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
