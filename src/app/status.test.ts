import { describe, expect, it } from "vitest";

import {
  saveFailureMessage,
  saveStatusPresentation,
  selectBanner,
  tabProblem,
} from "./status";

const base = {
  deleted: false,
  externallyModified: false,
  saveError: null,
  mixedLineEndings: false,
  singleFile: false,
};

describe("banner priority", () => {
  it("shows deletion before every other banner", () => {
    const banner = selectBanner({
      ...base,
      deleted: true,
      externallyModified: true,
      saveError: "denied",
      mixedLineEndings: true,
      singleFile: true,
    });
    expect(banner?.kind).toBe("deleted");
    expect(banner?.actions).toEqual(["resave", "close-tab"]);
  });

  it("shows modification before save failure", () => {
    expect(
      selectBanner({ ...base, externallyModified: true, saveError: "denied" })?.kind,
    ).toBe("external-modified");
  });

  it("keeps the backend error only as banner detail", () => {
    const banner = selectBanner({
      ...base,
      saveError: "没有权限保存这个文件",
      saveErrorDetail: 'workspace: permission denied: "a.md"',
    });
    expect(banner?.message).toBe("没有权限保存这个文件");
    expect(banner?.detail).toBe('workspace: permission denied: "a.md"');
  });

  it("maps common save failures to short Chinese messages", () => {
    expect(saveFailureMessage('workspace: file is read-only: "a.md"')).toBe(
      "文件是只读的，无法保存",
    );
    expect(saveFailureMessage("permission denied")).toBe(
      "没有权限保存这个文件",
    );
    expect(saveFailureMessage("no space left on device")).toBe(
      "磁盘空间不足，无法保存",
    );
    expect(saveFailureMessage("no such file or directory")).toBe(
      "文件已被删除或移走，无法保存",
    );
    expect(saveFailureMessage("workspace: path is outside the folder")).toBe(
      "文件路径超出工作区，无法保存",
    );
    expect(saveFailureMessage("something unexpected")).toBe(
      "保存失败，请稍后重试",
    );
  });

  it("keeps the single-file notice last", () => {
    expect(selectBanner({ ...base, singleFile: true })?.kind).toBe("single-file");
  });
});

describe("save status", () => {
  it("uses the labels from the interface spec", () => {
    expect(saveStatusPresentation("editing", false)).toEqual({
      label: "编辑中",
      tone: "muted",
    });
    expect(saveStatusPresentation("saving", false)).toEqual({
      label: "保存中",
      tone: "muted",
    });
    expect(saveStatusPresentation("saved", false)).toEqual({
      label: "已保存",
      tone: "success",
    });
    expect(saveStatusPresentation("failed", false)?.tone).toBe("danger");
    expect(saveStatusPresentation("saved", true)?.label).toBe(
      "换行风格混合，未自动保存",
    );
  });

  it("marks only problem tabs", () => {
    expect(tabProblem(false, false, false)).toBeNull();
    expect(tabProblem(true, false, false)).toBe("danger");
    expect(tabProblem(false, false, true)).toBe("danger");
    expect(tabProblem(false, true, false)).toBe("warning");
  });
});
