import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileReadingCSS,
  defaultWritingPreferences,
  normalizeWritingPreferences,
  useWritingPreferences,
  writingStatistics,
} from "./writing-preferences";

afterEach(() => vi.useRealTimers());
describe("writing preferences", () => {
  it("uses theme defaults and bounds numeric settings independently", () => {
    expect(defaultWritingPreferences()).toMatchObject({
      fontSize: 18,
      lineHeight: 1.7,
      contentWidth: 65,
      focusMode: false,
    });
    expect(
      normalizeWritingPreferences({
        fontSize: 99,
        lineHeight: Number.NaN,
        contentWidth: 12,
        focusMode: true,
      }),
    ).toMatchObject({
      fontSize: 36,
      lineHeight: 1.7,
      contentWidth: 40,
      focusMode: true,
    });
  });
  it("scopes accepted CSS and rejects resource and layout escapes", () => {
    expect(
      compileReadingCSS(".cm-content, p { color: red; margin: 1rem; }"),
    ).toEqual({
      css: "[data-nicole-reading] .cm-content,[data-nicole-reading] p { color: red;margin: 1rem }",
      error: null,
    });
    for (const source of [
      "@import 'https://x';",
      "p { color: url(https://x); }",
      "p { position: fixed; }",
      ":root { color: red; }",
      "p { color: red;",
      "p { background-color: u\\72l(x); }",
      "p { --image: u/**/rl(https://example.test/image.png); }",
    ])
      expect(compileReadingCSS(source).error).not.toBeNull();
  });
  it("counts document and selection without stripping Markdown", () => {
    expect(writingStatistics("你好 hello world", "你好")).toEqual({
      words: 4,
      selectedWords: 2,
      hasSelection: true,
      minutes: 1,
    });
    expect(writingStatistics("")).toEqual({
      words: 0,
      selectedWords: 0,
      hasSelection: false,
      minutes: 0,
    });
  });
  it("merges early field intents with loaded untouched fields before saving", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const control = useWritingPreferences({
      save,
      load: vi.fn(),
      onError: vi.fn(),
    });
    control.update({ focusMode: true });
    expect(save).not.toHaveBeenCalled();
    control.hydrate({
      ...defaultWritingPreferences(),
      fontSize: 24,
      customCss: "p { color:red; }",
    });
    await control.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        focusMode: true,
        fontSize: 24,
        customCss: "p { color:red; }",
      }),
    );
  });
  it("does not roll a newer choice back when an earlier queued write fails", async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const control = useWritingPreferences({ save, load: vi.fn(), onError });
    control.hydrate(defaultWritingPreferences());
    control.update({ fontSize: 22 });
    const first = control.flush();
    await Promise.resolve();
    control.update({ fontSize: 26 });
    const second = control.flush();
    reject(new Error("disk full"));
    await first;
    await second;
    expect(control.value.value.fontSize).toBe(26);
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ fontSize: 26 }),
    );
    expect(onError).toHaveBeenCalledOnce();
  });
  it("retries a missing baseline on explicit change without writing unknown fields", async () => {
    vi.useFakeTimers();
    let resolve!: (value: ReturnType<typeof defaultWritingPreferences>) => void;
    const load = vi.fn(
      () =>
        new Promise<ReturnType<typeof defaultWritingPreferences>>((done) => {
          resolve = done;
        }),
    );
    const save = vi.fn().mockResolvedValue(undefined);
    const control = useWritingPreferences({ load, save, onError: vi.fn() });
    control.update({ typewriterMode: true });
    control.flush();
    expect(load).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    resolve({ ...defaultWritingPreferences(), fontSize: 25 });
    await control.retry();
    await control.flush();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ typewriterMode: true, fontSize: 25 }),
    );
  });
});
