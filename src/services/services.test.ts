import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pickFolder: vi.fn(),
  openFolder: vi.fn(),
  listSnippets: vi.fn(),
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
  setEditorMode: vi.fn(),
  setOutlineVisible: vi.fn(),
  setFormatToolbarVisible: vi.fn(),
  setFonts: vi.fn(),
  setShowAllFiles: vi.fn(),
  setHideMarkdownExtension: vi.fn(),
  setSlashEnabled: vi.fn(),
  setSidebarWidth: vi.fn(),
  setExpandedFolders: vi.fn(),
  addRecentFolder: vi.fn(),
  removeRecentFolder: vi.fn(),
  chooseSingleFile: vi.fn(),
  acceptSingleFile: vi.fn(),
  dismissOfferedFile: vi.fn(),
  readSingleFile: vi.fn(),
  writeSingleFile: vi.fn(),
  releaseSingleFile: vi.fn(),
  popupNativeMenu: vi.fn(),
  setSettingsAccelerator: vi.fn(),
  takePendingOpenedFiles: vi.fn(),
  appOpenFileOn: vi.fn(),
  saveRecovery: vi.fn(),
  deleteRecovery: vi.fn(),
  discardRecovery: vi.fn(),
  listRecovery: vi.fn(),
  restoreRecoverySingleFile: vi.fn(),
}));

vi.mock("./mygo", () => ({
  Workspace: {
    pickFolder: mocks.pickFolder,
    openFolder: mocks.openFolder,
    listSnippets: mocks.listSnippets,
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
    setEditorMode: mocks.setEditorMode,
    setOutlineVisible: mocks.setOutlineVisible,
    setFormatToolbarVisible: mocks.setFormatToolbarVisible,
    setFonts: mocks.setFonts,
    setShowAllFiles: mocks.setShowAllFiles,
    setHideMarkdownExtension: mocks.setHideMarkdownExtension,
    setSlashEnabled: mocks.setSlashEnabled,
    setSidebarWidth: mocks.setSidebarWidth,
    setExpandedFolders: mocks.setExpandedFolders,
    addRecentFolder: mocks.addRecentFolder,
    removeRecentFolder: mocks.removeRecentFolder,
  },
  SingleFileService: {
    chooseSingleFile: mocks.chooseSingleFile,
    acceptSingleFile: mocks.acceptSingleFile,
    dismissOfferedFile: mocks.dismissOfferedFile,
    readSingleFile: mocks.readSingleFile,
    writeSingleFile: mocks.writeSingleFile,
    releaseSingleFile: mocks.releaseSingleFile,
  },
  NativeMenu: {
    popupNativeMenu: mocks.popupNativeMenu,
    setSettingsAccelerator: mocks.setSettingsAccelerator,
  },
  OpenedFiles: {
    takePendingOpenedFiles: mocks.takePendingOpenedFiles,
  },
  Recovery: {
    save: mocks.saveRecovery,
    delete: mocks.deleteRecovery,
    discard: mocks.discardRecovery,
    list: mocks.listRecovery,
    restoreSingleFile: mocks.restoreRecoverySingleFile,
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
import { listSnippets, openFolder, pickFolder } from "./workspace";
import { popupNativeMenu, setSettingsAccelerator } from "./menu";
import { onOpenFile, takePendingOpenedFiles } from "./open-file";
import {
  acceptSingleFile,
  chooseSingleFile,
  dismissOfferedFile,
  readSingleFile,
  releaseSingleFile,
  writeSingleFile,
} from "./single-file";
import {
  deleteRecovery,
  discardRecovery,
  listRecovery,
  restoreRecoverySingleFile,
  saveRecovery,
} from "./recovery";
import {
  addRecentFolder,
  getSettings,
  migrateLegacyTheme,
  removeRecentFolder,
  setEditorMode,
  setExpandedFolders,
  setFonts,
  setFormatToolbarVisible,
  setHideMarkdownExtension,
  setOutlineVisible,
  setShowAllFiles,
  setSidebarWidth,
  setSlashEnabled,
  setTheme,
} from "./settings";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pickFolder.mockResolvedValue({ path: "/notes", canceled: false });
  mocks.openFolder.mockResolvedValue({
    root: "/notes",
    files: [],
    canceled: false,
    generation: 1,
  });
  mocks.listSnippets.mockResolvedValue({
    snippets: [{ id: "snippet:a.md", label: "a", body: "x" }],
    warnings: [],
  });
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
  mocks.setEditorMode.mockResolvedValue(undefined);
  mocks.setOutlineVisible.mockResolvedValue(undefined);
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
  mocks.dismissOfferedFile.mockResolvedValue(undefined);
  mocks.readSingleFile.mockResolvedValue("text");
  mocks.writeSingleFile.mockResolvedValue(undefined);
  mocks.releaseSingleFile.mockResolvedValue(undefined);
  mocks.popupNativeMenu.mockResolvedValue("new-file");
  mocks.takePendingOpenedFiles.mockResolvedValue(["/tmp/note.md"]);
  mocks.appOpenFileOn.mockReturnValue(() => {});
  mocks.saveRecovery.mockResolvedValue("0123456789abcdef");
  mocks.deleteRecovery.mockResolvedValue(undefined);
  mocks.discardRecovery.mockResolvedValue(undefined);
  mocks.listRecovery.mockResolvedValue({ items: [], otherFolders: 0 });
  mocks.restoreRecoverySingleFile.mockResolvedValue({
    path: "/tmp/note.md",
    name: "note.md",
  });
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

  it("picks and opens folders without bypassing the backend guard", async () => {
    await expect(pickFolder()).resolves.toEqual({
      path: "/notes",
      canceled: false,
    });
    await expect(openFolder("/notes")).resolves.toEqual({
      root: "/notes",
      files: [],
      canceled: false,
      generation: 1,
    });
    expect(mocks.pickFolder).toHaveBeenCalledOnce();
    expect(mocks.openFolder).toHaveBeenCalledWith("/notes");
  });

  it("reads user templates by generation only", async () => {
    await expect(listSnippets(3)).resolves.toEqual({
      snippets: [{ id: "snippet:a.md", label: "a", body: "x" }],
      warnings: [],
    });
    expect(mocks.listSnippets).toHaveBeenCalledWith(3);
  });

  it("forwards settings calls", async () => {
    await getSettings();
    await migrateLegacyTheme("dark");
    await setTheme("light");
    await setEditorMode("source");
    await setOutlineVisible(true);
    await setFormatToolbarVisible(true);
    await setFonts("Interface", "Reading", "Code");
    await setShowAllFiles(false);
    await setHideMarkdownExtension(true);
    await setSlashEnabled("immersive", false);
    await setSidebarWidth(300);
    await setExpandedFolders("/notes", ["a"]);
    await addRecentFolder("/notes");
    await removeRecentFolder("/notes");

    expect(mocks.getSettings).toHaveBeenCalledOnce();
    expect(mocks.migrateLegacyTheme).toHaveBeenCalledWith("dark");
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
    expect(mocks.setEditorMode).toHaveBeenCalledWith("source");
    expect(mocks.setOutlineVisible).toHaveBeenCalledWith(true);
    expect(mocks.setFormatToolbarVisible).toHaveBeenCalledWith(true);
    expect(mocks.setFonts).toHaveBeenCalledWith("Interface", "Reading", "Code");
    expect(mocks.setShowAllFiles).toHaveBeenCalledWith(false);
    expect(mocks.setHideMarkdownExtension).toHaveBeenCalledWith(true);
    expect(mocks.setSlashEnabled).toHaveBeenCalledWith("immersive", false);
    expect(mocks.setSidebarWidth).toHaveBeenCalledWith(300);
    expect(mocks.setExpandedFolders).toHaveBeenCalledWith("/notes", ["a"]);
    expect(mocks.addRecentFolder).toHaveBeenCalledWith("/notes");
    expect(mocks.removeRecentFolder).toHaveBeenCalledWith("/notes");
  });

  it("forwards single-file calls", async () => {
    await chooseSingleFile();
    await acceptSingleFile("/tmp/note.md");
    await dismissOfferedFile("/tmp/note.md");
    await expect(readSingleFile("/tmp/note.md")).resolves.toBe("text");
    await writeSingleFile("/tmp/note.md", "new");
    await releaseSingleFile("/tmp/note.md");

    expect(mocks.chooseSingleFile).toHaveBeenCalledOnce();
    expect(mocks.acceptSingleFile).toHaveBeenCalledWith("/tmp/note.md");
    expect(mocks.dismissOfferedFile).toHaveBeenCalledWith("/tmp/note.md");
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
    await setSettingsAccelerator("Cmd+,");
    expect(mocks.setSettingsAccelerator).toHaveBeenCalledWith("Cmd+,");

    const handler = vi.fn();
    const off = onOpenFile(handler);
    expect(mocks.appOpenFileOn).toHaveBeenCalledOnce();
    const registered = mocks.appOpenFileOn.mock.calls[0]?.[0] as (
      signal: boolean,
    ) => void;
    registered(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith();
    off();

    await expect(takePendingOpenedFiles()).resolves.toEqual(["/tmp/note.md"]);
    expect(mocks.takePendingOpenedFiles).toHaveBeenCalledOnce();
  });
});

describe("recovery wrappers", () => {
  it("forwards copy lifecycle calls", async () => {
    const copy = {
      kind: "workspace",
      root: "/notes",
      path: "a.md",
      lineEnding: "\n",
      text: "text",
    };
    await expect(saveRecovery(copy, 3)).resolves.toBe("0123456789abcdef");
    await deleteRecovery("0123456789abcdef", 3);
    await discardRecovery(["1111111111111111"], 3);
    await expect(listRecovery(3)).resolves.toEqual({ items: [], otherFolders: 0 });
    await expect(restoreRecoverySingleFile("2222222222222222")).resolves.toEqual({
      path: "/tmp/note.md",
      name: "note.md",
    });

    expect(mocks.saveRecovery).toHaveBeenCalledWith(copy, 3);
    expect(mocks.deleteRecovery).toHaveBeenCalledWith("0123456789abcdef", 3);
    expect(mocks.discardRecovery).toHaveBeenCalledWith(
      ["1111111111111111"],
      3,
    );
    expect(mocks.listRecovery).toHaveBeenCalledWith(3);
    expect(mocks.restoreRecoverySingleFile).toHaveBeenCalledWith(
      "2222222222222222",
    );
  });
});
