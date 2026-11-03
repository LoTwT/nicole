import { describe, expect, it } from "vitest";

import { appPlatform, revealLabel, trashLabel } from "./platform";

describe("platform labels", () => {
  it("uses the platform wording", () => {
    expect(appPlatform("darwin")).toBe("macos");
    expect(appPlatform("win32")).toBe("windows");
    expect(appPlatform("linux")).toBe("linux");
    expect(revealLabel("windows")).toBe("在资源管理器中显示");
    expect(revealLabel("linux")).toBe("在文件管理器中显示");
    expect(trashLabel("macos")).toBe("移到废纸篓");
    expect(trashLabel("windows")).toBe("移到回收站");
  });
});
