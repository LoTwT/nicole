import { createApp, defineComponent, h, nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  trashEntry: vi.fn(),
  openWithDefaultApp: vi.fn(),
  revealEntry: vi.fn(),
  popupNativeMenu: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock("../services/files", () => ({
  listDirectory: mocks.listDirectory,
  createFile: mocks.createFile,
  createFolder: mocks.createFolder,
  renameEntry: mocks.renameEntry,
  trashEntry: mocks.trashEntry,
  openWithDefaultApp: mocks.openWithDefaultApp,
  revealEntry: mocks.revealEntry,
}));
vi.mock("../services/menu", () => ({
  popupNativeMenu: mocks.popupNativeMenu,
}));
vi.mock("../services/clipboard", () => ({
  copyText: mocks.copyText,
}));

import FileTree from "./FileTree.vue";

const rootEntries = [
  {
    name: "a.md",
    path: "a.md",
    isDir: false,
    isMarkdown: true,
    size: 10,
  },
  {
    name: "notes",
    path: "notes",
    isDir: true,
    isMarkdown: false,
    size: 0,
  },
];
const noteEntries = [
  {
    name: "b.md",
    path: "notes/b.md",
    isDir: false,
    isMarkdown: true,
    size: 20,
  },
];

let host: HTMLElement;
let app: ReturnType<typeof createApp> | null = null;
let treeApi: InstanceType<typeof FileTree> | null = null;
let mountedProps: {
  showAllFiles: boolean;
  hideMarkdownExtension: boolean;
} | null = null;
let events: {
  open: ReturnType<typeof vi.fn>;
  created: ReturnType<typeof vi.fn>;
  renaming: ReturnType<typeof vi.fn>;
  renameFailed: ReturnType<typeof vi.fn>;
  renamed: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
  expanded: ReturnType<typeof vi.fn>;
  runCommand: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
};

async function settle() {
  for (let index = 0; index < 12; index++) {
    await nextTick();
  }
}

function mountTree(
  initialExpanded: string[] = [],
  platform: "macos" | "windows" | "linux" = "macos",
  selectedPath: string | null = null,
) {
  const props = reactive({
    rootPath: "/tmp/notes",
    generation: 3,
    selectedPath,
    platform,
    initialExpanded,
    showAllFiles: true,
    hideMarkdownExtension: false,
  });
  mountedProps = props;
  events = {
    open: vi.fn(),
    created: vi.fn(),
    renaming: vi.fn(),
    renameFailed: vi.fn(),
    renamed: vi.fn(),
    trash: vi.fn(),
    expanded: vi.fn(),
    runCommand: vi.fn(),
    status: vi.fn(),
  };
  const Component = defineComponent({
    setup() {
      return () =>
        h(FileTree, {
          ...props,
          ref: (value: unknown) => {
            treeApi = value as InstanceType<typeof FileTree> | null;
          },
          onOpenEntry: events.open,
          onEntryCreated: events.created,
          onEntryRenaming: events.renaming,
          onEntryRenameFailed: events.renameFailed,
          onEntryRenamed: events.renamed,
          onTrashRequest: events.trash,
          onExpandedChange: events.expanded,
          onRunCommand: events.runCommand,
          onStatus: (message: string) => {
            (events.status as unknown as (value: string) => void)(message);
          },
        });
    },
  });
  app = createApp(Component);
  app.mount(host);
}

function row(name: string): HTMLElement {
  const found = [...host.querySelectorAll<HTMLElement>("[data-tree-path]")].find(
    (item) => item.textContent?.includes(name),
  );
  if (!found) throw new Error(`row ${name} not found`);
  return found;
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  host = document.querySelector<HTMLElement>("#app")!;
  vi.clearAllMocks();
  mocks.listDirectory.mockImplementation(async (path: string) => {
    if (path === ".") return { path: ".", entries: rootEntries };
    if (path === "notes") return { path: "notes", entries: noteEntries };
    return { path, entries: [] };
  });
  mocks.createFile.mockResolvedValue("new.md");
  mocks.createFolder.mockResolvedValue("folder");
  mocks.renameEntry.mockImplementation(async (path: string, name: string) => {
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    return parent ? `${parent}/${name}` : name;
  });
  mocks.trashEntry.mockResolvedValue(undefined);
  mocks.openWithDefaultApp.mockResolvedValue(undefined);
  mocks.revealEntry.mockResolvedValue(undefined);
  mocks.popupNativeMenu.mockResolvedValue("");
  mocks.copyText.mockResolvedValue(true);
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("FileTree", () => {
  it("loads the first level and opens Markdown entries", async () => {
    mountTree();
    await settle();
    expect(host.querySelector('[role="tree"]')).not.toBeNull();
    expect(host.textContent).toContain("a.md");
    expect(host.textContent).toContain("notes");
    expect(mocks.listDirectory).toHaveBeenCalledWith(".");

    row("a.md").click();
    expect(events.open).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.md", isMarkdown: true }),
    );
  });

  it("uses the shared selected-row color and the file-tree hover color", async () => {
    mountTree([], "macos", "a.md");
    await settle();
    expect(row("a.md").className).toContain(
      "bg-[var(--nicole-selected-row)]",
    );
    expect(row("a.md").className).not.toContain(
      "hover:bg-[var(--nicole-file-tree-hover)]",
    );
    expect(row("notes").className).toContain(
      "hover:bg-[var(--nicole-file-tree-hover)]",
    );
    expect(row("notes").className).not.toContain(
      "hover:bg-[var(--surface-subtle)]",
    );
  });

  it("reads a folder on first expansion and remembers it", async () => {
    mountTree();
    await settle();
    row("notes").click();
    await settle();
    expect(mocks.listDirectory).toHaveBeenCalledWith("notes");
    expect(host.textContent).toContain("b.md");
    expect(events.expanded).toHaveBeenCalledWith(["notes"]);
  });

  it("restores stored expansion lazily", async () => {
    mountTree(["notes"]);
    await settle();
    expect(mocks.listDirectory).toHaveBeenCalledWith("notes");
    expect(host.textContent).toContain("b.md");
  });

  it("expands an empty folder without a placeholder and still starts new files", async () => {
    const emptyFolder = {
      name: "empty",
      path: "empty",
      isDir: true,
      isMarkdown: false,
      size: 0,
    };
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries: path === "." ? [emptyFolder] : [],
    }));
    mountTree();
    await settle();

    row("empty").click();
    await settle();
    expect(mocks.listDirectory).toHaveBeenCalledWith("empty");
    expect(row("empty").getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).not.toContain("空文件夹");

    await treeApi!.startCreate("create-file", "empty");
    await settle();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="新建文件"]'),
    ).not.toBeNull();
  });

  it("uses the native menu for a file and starts an inline rename", async () => {
    mocks.popupNativeMenu.mockResolvedValue("rename");
    mountTree();
    await settle();
    row("a.md").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }),
    );
    await settle();
    expect(mocks.popupNativeMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 20,
        y: 30,
        items: expect.arrayContaining([
          expect.objectContaining({ id: "rename" }),
          expect.objectContaining({ id: "copy-path" }),
        ]),
      }),
    );
    const input = host.querySelector<HTMLInputElement>('input[aria-label="重命名"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe("a.md");
    expect(input?.selectionStart).toBe(0);
    expect(input?.selectionEnd).toBe(1);

    input!.value = "renamed.md";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(mocks.renameEntry).toHaveBeenCalledWith("a.md", "renamed.md", 3);
    expect(events.renamed).toHaveBeenCalledWith("a.md", "renamed.md", false);
  });

  it("announces an expected rename before the backend resolves", async () => {
    mocks.popupNativeMenu.mockResolvedValue("rename");
    let finish!: (value: string) => void;
    mocks.renameEntry.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    mountTree();
    await settle();
    row("a.md").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="重命名"]')!;
    input.value = "renamed.md";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();

    expect(events.renaming).toHaveBeenCalledWith("a.md", "renamed.md", false);
    expect(events.renamed).not.toHaveBeenCalled();
    finish("renamed.md");
    await settle();
    expect(events.renamed).toHaveBeenCalledWith("a.md", "renamed.md", false);
  });

  it("reports a failed rename so the expected path is discarded", async () => {
    mocks.popupNativeMenu.mockResolvedValue("rename");
    mocks.renameEntry.mockRejectedValue(new Error("exists"));
    mountTree();
    await settle();
    row("a.md").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="重命名"]')!;
    input.value = "renamed.md";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();

    expect(events.renaming).toHaveBeenCalledWith("a.md", "renamed.md", false);
    expect(events.renameFailed).toHaveBeenCalledWith("a.md");
    expect(events.renamed).not.toHaveBeenCalled();
  });

  it("creates a file from the blank-area menu", async () => {
    mocks.popupNativeMenu.mockResolvedValue("new-file");
    mountTree();
    await settle();
    host
      .querySelector('[role="tree"]')!
      .dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    await settle();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="新建文件"]');
    expect(input?.value).toBe("未命名.md");
    input!.value = "post";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(mocks.createFile).toHaveBeenCalledWith(".", "post", 3);
    expect(events.created).toHaveBeenCalledWith("new.md", false);
  });

  it("asks the app to confirm folder deletion and copies paths", async () => {
    mocks.popupNativeMenu.mockResolvedValueOnce("trash");
    mountTree();
    await settle();
    row("notes").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(events.trash).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes", isDir: true }),
    );

    mocks.popupNativeMenu.mockResolvedValueOnce("copy-path");
    row("a.md").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    expect(mocks.copyText).toHaveBeenCalledWith("/tmp/notes/a.md");
  });

  it("moves focus with arrow keys and expands with Right", async () => {
    mountTree();
    await settle();
    const folder = row("notes");
    folder.focus();
    folder.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    await settle();
    expect(document.activeElement?.textContent).toContain("a.md");

    row("notes").focus();
    row("notes").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await settle();
    expect(mocks.listDirectory).toHaveBeenCalledWith("notes");
  });

  it("keeps focus on a first-level item when pressing ArrowLeft", async () => {
    mountTree();
    await settle();
    const first = row("a.md");
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(first);
    expect(first.tabIndex).toBe(0);
  });

  it("moves focus to the next sibling after removing the focused item", async () => {
    mountTree();
    await settle();
    row("a.md").focus();
    await treeApi!.removePath("a.md");
    await settle();
    expect(document.activeElement).toBe(row("notes"));
  });

  it("moves focus to the previous sibling when no next sibling remains", async () => {
    mountTree();
    await settle();
    row("notes").focus();
    await treeApi!.removePath("notes");
    await settle();
    expect(document.activeElement).toBe(row("a.md"));
  });

  it("moves focus to the parent when no sibling remains", async () => {
    mountTree(["notes"]);
    await settle();
    row("b.md").focus();
    await treeApi!.removePath("notes/b.md");
    await settle();
    expect(document.activeElement).toBe(row("notes"));
  });

  it("falls back to the first visible item when focusedPath is hidden", async () => {
    mountTree([], "macos", "missing.md");
    await settle();
    const stops = host.querySelectorAll<HTMLElement>(
      '[role="treeitem"][tabindex="0"]',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(row("notes"));
  });

  it("focuses the first item after collapsing all while the tree has focus", async () => {
    mountTree(["notes"]);
    await settle();
    row("b.md").focus();
    await treeApi!.collapseAll();
    await settle();
    expect(document.activeElement).toBe(row("notes"));
    expect(host.querySelectorAll('[role="treeitem"][tabindex="0"]')).toHaveLength(1);
  });

  it("returns focus to the tree item when creation started from a menu is cancelled", async () => {
    mocks.popupNativeMenu.mockResolvedValue("new-file");
    mountTree();
    await settle();
    const source = row("a.md");
    source.focus();
    source.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    expect(document.activeElement).toBe(row("a.md"));
  });

  it("falls back to a visible selected item when focusedPath is hidden", async () => {
    mountTree([], "macos", "notes");
    await settle();
    await treeApi!.reveal("missing");
    await settle();
    const stops = host.querySelectorAll<HTMLElement>(
      '[role="treeitem"][tabindex="0"]',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0]).toBe(row("notes"));
  });

  it("focuses the empty-folder action after removing the last tree item", async () => {
    mocks.listDirectory.mockImplementation(async (path: string) => ({
      path,
      entries: path === "." ? [rootEntries[0]!] : [],
    }));
    mountTree();
    await settle();
    row("a.md").focus();
    await treeApi!.removePath("a.md");
    await settle();
    const emptyButton = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === "新建文件",
    )!;
    expect(document.activeElement).toBe(emptyButton);
  });

  it("does not move focus when an empty inline name is submitted by blur", async () => {
    mocks.popupNativeMenu.mockResolvedValue("new-file");
    mountTree();
    await settle();
    row("a.md").focus();
    row("a.md").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await settle();
    expect(document.activeElement).toBe(outside);
    expect(input.isConnected).toBe(false);
  });

  it("dispatches macOS file-tree shortcuts from the registry", async () => {
    mountTree();
    await settle();

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        code: "ArrowDown",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(events.open).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.md" }),
    );

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        code: "Backspace",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(events.trash).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.md" }),
    );

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="重命名"]'),
    ).not.toBeNull();
  });

  it("creates a folder with the file-tree shortcut", async () => {
    mountTree();
    await settle();

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "n",
        code: "KeyN",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件夹"]',
    );
    expect(input).not.toBeNull();
    input!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    await settle();
    expect(mocks.createFolder).toHaveBeenCalledWith(
      ".",
      "未命名文件夹",
      3,
    );
  });

  it("gives inline rename and create inputs the normal row's leading slot", async () => {
    mountTree(["notes"]);
    await settle();

    const normalSlot = row("a.md").firstElementChild;
    expect(normalSlot?.tagName).toBe("SPAN");
    expect(normalSlot?.classList.contains("w-3")).toBe(true);

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const renameRow = host.querySelector<HTMLElement>(
      '[data-tree-path="a.md"]',
    )!;
    expect(renameRow.querySelector("input")).not.toBeNull();
    const renameSlot = renameRow.firstElementChild;
    expect(renameSlot?.tagName).toBe("SPAN");
    expect(renameSlot?.classList.contains("w-3")).toBe(true);
    expect(renameRow.classList.contains("gap-1.5")).toBe(true);

    renameRow
      .querySelector<HTMLInputElement>("input")!
      .dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    await settle();

    await treeApi!.startCreate("create-file", "notes");
    await settle();
    const createInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    const createRow = createInput.parentElement!;
    const nestedNormalSlot = row("b.md").firstElementChild;
    expect(nestedNormalSlot?.tagName).toBe("SPAN");
    expect(nestedNormalSlot?.classList.contains("w-3")).toBe(true);
    expect(createRow.firstElementChild?.tagName).toBe("SPAN");
    expect(createRow.firstElementChild?.classList.contains("w-3")).toBe(true);
    expect(createRow.classList.contains("gap-1.5")).toBe(true);

    await treeApi!.startCreate("create-file", ".");
    await settle();
    const rootCreateInput = host.querySelector<HTMLInputElement>(
      'input[aria-label="新建文件"]',
    )!;
    const rootCreateRow = rootCreateInput.parentElement!;
    expect(rootCreateRow.firstElementChild?.tagName).toBe("SPAN");
    expect(rootCreateRow.firstElementChild?.classList.contains("w-3")).toBe(
      true,
    );
    expect(rootCreateRow.classList.contains("gap-1.5")).toBe(true);
  });

  it("disables text selection on rows but keeps inline inputs selectable", async () => {
    mountTree();
    await settle();
    expect(row("a.md").classList.contains("select-none")).toBe(true);

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="重命名"]',
    )!;
    expect(input.classList.contains("select-text")).toBe(true);
    expect(input.classList.contains("select-none")).toBe(false);
    expect(input.parentElement?.classList.contains("select-none")).toBe(false);
  });

  it("uses Enter, F2 and Delete on Windows", async () => {
    mountTree([], "windows");
    await settle();

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(events.open).toHaveBeenCalledWith(
      expect.objectContaining({ path: "a.md" }),
    );

    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F2",
        code: "F2",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    expect(
      host.querySelector<HTMLInputElement>('input[aria-label="重命名"]'),
    ).not.toBeNull();

    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="重命名"]',
    )!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await settle();
    row("notes").focus();
    row("notes").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Delete",
        code: "Delete",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(events.trash).toHaveBeenCalledWith(
      expect.objectContaining({ path: "notes" }),
    );
  });

  it("keeps Delete and arrow keys inside the Windows rename input", async () => {
    mountTree([], "windows");
    await settle();
    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F2",
        code: "F2",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="重命名"]',
    )!;
    expect(document.activeElement).toBe(input);

    const remove = new KeyboardEvent("keydown", {
      key: "Delete",
      code: "Delete",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(remove);
    await settle();
    expect(events.trash).not.toHaveBeenCalled();
    expect(remove.defaultPrevented).toBe(false);

    const down = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(down);
    await settle();
    expect(document.activeElement).toBe(input);
    expect(down.defaultPrevented).toBe(false);
  });

  it("keeps Cmd+Backspace inside the macOS rename input", async () => {
    mountTree();
    await settle();
    row("a.md").focus();
    row("a.md").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await settle();
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="重命名"]',
    )!;
    expect(document.activeElement).toBe(input);

    const remove = new KeyboardEvent("keydown", {
      key: "Backspace",
      code: "Backspace",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(remove);
    await settle();
    expect(events.trash).not.toHaveBeenCalled();
    expect(remove.defaultPrevented).toBe(false);
  });

  it("ignores tree navigation during input-method composition", async () => {
    mountTree();
    await settle();
    row("notes").focus();
    const event = new KeyboardEvent("keydown", {
      key: "ArrowDown",
      code: "ArrowDown",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    row("notes").dispatchEvent(event);
    await settle();
    expect(document.activeElement?.textContent).toContain("notes");
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("file display preferences", () => {
  it("filters only files and hides .md labels without changing paths", async () => {
    const withImage = [
      ...rootEntries,
      {
        name: "cover.png",
        path: "cover.png",
        isDir: false,
        isMarkdown: false,
        size: 4,
      },
    ];
    mocks.listDirectory.mockImplementation(async (path: string) => {
      if (path === ".") return { path: ".", entries: withImage };
      if (path === "notes") return { path: "notes", entries: noteEntries };
      return { path, entries: [] };
    });
    mountTree();
    await settle();
    expect(() => row("cover.png")).not.toThrow();
    expect(() => row("a.md")).not.toThrow();

    mountedProps!.showAllFiles = false;
    await settle();
    expect(host.querySelector('[data-tree-path="cover.png"]')).toBeNull();
    expect(host.querySelector('[data-tree-path="a.md"]')).not.toBeNull();
    expect(host.querySelector('[data-tree-path="notes"]')).not.toBeNull();

    mountedProps!.hideMarkdownExtension = true;
    await settle();
    const markdown = host.querySelector('[data-tree-path="a.md"]')!;
    expect(markdown.textContent?.trim()).toBe("a");
    expect(markdown.getAttribute("data-tree-path")).toBe("a.md");

    mocks.popupNativeMenu.mockResolvedValue("rename");
    markdown.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 4,
        clientY: 4,
      }),
    );
    await settle();
    const rename = host.querySelector<HTMLInputElement>(
      'input[aria-label="重命名"]',
    )!;
    expect(rename.value).toBe("a.md");
  });
});

describe("workspace-level tree actions", () => {
  it("removes the root row and keeps blank-area root actions", async () => {
    mocks.popupNativeMenu.mockResolvedValue("app.close-workspace");
    mountTree();
    await settle();
    expect(
      host.querySelector('[role="group"][aria-label^="根目录"]'),
    ).toBeNull();

    host
      .querySelector('[role="tree"]')!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 20,
        }),
      );
    await settle();
    const request = vi.mocked(mocks.popupNativeMenu).mock.calls[0]![0];
    expect(request.items.map((item: { label: string }) => item.label)).toEqual([
      "新建文件",
      "新建文件夹",
      "",
      "在 Finder 中显示",
      "",
      "复制路径",
      "",
      "关闭工作区",
    ]);
    expect(events.runCommand).toHaveBeenCalledWith("app.close-workspace");
  });
});
