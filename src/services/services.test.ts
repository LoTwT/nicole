import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDirectory: vi.fn(),
  createFile: vi.fn(),
  createFolder: vi.fn(),
  renameEntry: vi.fn(),
  trashEntry: vi.fn(),
  openWithDefaultApp: vi.fn(),
  revealEntry: vi.fn(),
  getSettings: vi.fn(),
  migrateLegacyTheme: vi.fn(),
  setTheme: vi.fn(),
  setSidebarWidth: vi.fn(),
  setExpandedFolders: vi.fn(),
  addRecentFolder: vi.fn(),
  removeRecentFolder: vi.fn(),
  chooseSingleFile: vi.fn(),
  acceptSingleFile: vi.fn(),
  readSingleFile: vi.fn(),
  writeSingleFile: vi.fn(),
  releaseSingleFile: vi.fn(),
  popupNativeMenu: vi.fn(),
  takePendingOpenedFiles: vi.fn(),
  appOpenFileOn: vi.fn(),
}));

vi.mock("./mygo", () => ({
  Workspace: {
    listDirectory: mocks.listDirectory,
    createFile: mocks.createFile,
    createFolder: mocks.createFolder,
    renameEntry: mocks.renameEntry,
    trashEntry: mocks.trashEntry,
    openWithDefaultApp: mocks.openWithDefaultApp,
    revealEntry: mocks.revealEntry,
  },
  Settings: {
    get: mocks.getSettings,
    migrateLegacyTheme: mocks.migrateLegacyTheme,
    setTheme: mocks.setTheme,
    setSidebarWidth: mocks.setSidebarWidth,
    setExpandedFolders: mocks.setExpandedFolders,
    addRecentFolder: mocks.addRecentFolder,
    removeRecentFolder: mocks.removeRecentFolder,
  },
  SingleFileService: {
    chooseSingleFile: mocks.chooseSingleFile,
    acceptSingleFile: mocks.acceptSingleFile,
    readSingleFile: mocks.readSingleFile,
    writeSingleFile: mocks.writeSingleFile,
    releaseSingleFile: mocks.releaseSingleFile,
  },
  NativeMenu: {
    popupNativeMenu: mocks.popupNativeMenu,
  },
  OpenedFiles: {
    takePendingOpenedFiles: mocks.takePendingOpenedFiles,
  },
  events: {
    appOpenFile: {
      on: mocks.appOpenFileOn,
    },
  },
}));

import {
  createFile,
  createFolder,
  listDirectory,
  openWithDefaultApp,
  renameEntry,
  revealEntry,
  trashEntry,
} from "./files";
import { popupNativeMenu } from "./menu";
import { onOpenFile, takePendingOpenedFiles } from "./open-file";
import {
  acceptSingleFile,
  chooseSingleFile,
  readSingleFile,
  releaseSingleFile,
  writeSingleFile,
} from "./single-file";
import {
  addRecentFolder,
  getSettings,
  migrateLegacyTheme,
  removeRecentFolder,
  setExpandedFolders,
  setSidebarWidth,
  setTheme,
} from "./settings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listDirectory.mockResolvedValue({ path: ".", entries: [] });
  mocks.createFile.mockResolvedValue("note.md");
  mocks.createFolder.mockResolvedValue("notes");
  mocks.renameEntry.mockResolvedValue("renamed.md");
  mocks.trashEntry.mockResolvedValue(undefined);
  mocks.openWithDefaultApp.mockResolvedValue(undefined);
  mocks.revealEntry.mockResolvedValue(undefined);
  mocks.getSettings.mockResolvedValue({
    theme: "system",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  });
  mocks.migrateLegacyTheme.mockResolvedValue({
    theme: "dark",
    sidebarWidth: 252,
    recentFolders: [],
    expandedFolders: {},
  });
  mocks.setTheme.mockResolvedValue(undefined);
  mocks.setSidebarWidth.mockResolvedValue(undefined);
  mocks.setExpandedFolders.mockResolvedValue(undefined);
  mocks.addRecentFolder.mockResolvedValue(undefined);
  mocks.removeRecentFolder.mockResolvedValue(undefined);
  mocks.chooseSingleFile.mockResolvedValue({
    path: "/tmp/note.md",
    name: "note.md",
    canceled: false,
  });
  mocks.acceptSingleFile.mockResolvedValue({
    path: "/tmp/note.md",
    name: "note.md",
  });
  mocks.readSingleFile.mockResolvedValue("text");
  mocks.writeSingleFile.mockResolvedValue(undefined);
  mocks.releaseSingleFile.mockResolvedValue(undefined);
  mocks.popupNativeMenu.mockResolvedValue("new-file");
  mocks.takePendingOpenedFiles.mockResolvedValue(["/tmp/note.md"]);
  mocks.appOpenFileOn.mockReturnValue(() => {});
});

describe("service wrappers", () => {
  it("forwards workspace tree and file operations", async () => {
    await expect(listDirectory("notes")).resolves.toEqual({
      path: ".",
      entries: [],
    });
    await expect(createFile("notes", "note", 3)).resolves.toBe("note.md");
    await expect(createFolder("notes", "new", 3)).resolves.toBe("notes");
    await expect(renameEntry("note.md", "renamed.md", 3)).resolves.toBe(
      "renamed.md",
    );
    await trashEntry("note.md", 3);
    await openWithDefaultApp("image.png", 3);
    await revealEntry("notes", 3);

    expect(mocks.listDirectory).toHaveBeenCalledWith("notes");
    expect(mocks.createFile).toHaveBeenCalledWith("notes", "note", 3);
    expect(mocks.createFolder).toHaveBeenCalledWith("notes", "new", 3);
    expect(mocks.renameEntry).toHaveBeenCalledWith(
      "note.md",
      "renamed.md",
      3,
    );
    expect(mocks.trashEntry).toHaveBeenCalledWith("note.md", 3);
    expect(mocks.openWithDefaultApp).toHaveBeenCalledWith("image.png", 3);
    expect(mocks.revealEntry).toHaveBeenCalledWith("notes", 3);
  });

  it("forwards settings calls", async () => {
    await getSettings();
    await migrateLegacyTheme("dark");
    await setTheme("light");
    await setSidebarWidth(300);
    await setExpandedFolders("/notes", ["a"]);
    await addRecentFolder("/notes");
    await removeRecentFolder("/notes");

    expect(mocks.getSettings).toHaveBeenCalledOnce();
    expect(mocks.migrateLegacyTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
    expect(mocks.setSidebarWidth).toHaveBeenCalledWith(300);
    expect(mocks.setExpandedFolders).toHaveBeenCalledWith("/notes", ["a"]);
    expect(mocks.addRecentFolder).toHaveBeenCalledWith("/notes");
    expect(mocks.removeRecentFolder).toHaveBeenCalledWith("/notes");
  });

  it("forwards single-file calls", async () => {
    await chooseSingleFile();
    await acceptSingleFile("/tmp/note.md");
    await expect(readSingleFile("/tmp/note.md")).resolves.toBe("text");
    await writeSingleFile("/tmp/note.md", "new");
    await releaseSingleFile("/tmp/note.md");

    expect(mocks.chooseSingleFile).toHaveBeenCalledOnce();
    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/tmp/note.md");
    expect(mocks.readSingleFile).toHaveBeenCalledWith("/tmp/note.md");
    expect(mocks.writeSingleFile).toHaveBeenCalledWith("/tmp/note.md", "new");
    expect(mocks.releaseSingleFile).toHaveBeenCalledWith("/tmp/note.md");
  });

  it("forwards native menus and the open-file event", async () => {
    const request = {
      x: 4,
      y: 8,
      items: [{ id: "new-file", label: "新建文件" }],
    };
    await expect(popupNativeMenu(request)).resolves.toBe("new-file");
    expect(mocks.popupNativeMenu).toHaveBeenCalledWith(request);

    const handler = vi.fn();
    const off = onOpenFile(handler);
    expect(mocks.appOpenFileOn).toHaveBeenCalledWith(handler);
    const registered = mocks.appOpenFileOn.mock.calls[0]?.[0] as (
      path: string,
    ) => void;
    registered("/tmp/from-system.md");
    expect(handler).toHaveBeenCalledWith("/tmp/from-system.md");
    off();

    await expect(takePendingOpenedFiles()).resolves.toEqual(["/tmp/note.md"]);
    expect(mocks.takePendingOpenedFiles).toHaveBeenCalledOnce();
  });
});
