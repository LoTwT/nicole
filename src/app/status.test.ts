import { describe, expect, it } from "vitest";

import {
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
