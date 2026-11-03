import { describe, expect, it } from "vitest";

import { countWords, describeWordDifference } from "./word-count";

describe("countWords", () => {
  it("counts every CJK character and one per other word", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("中文 mixed text 2026")).toBe(5);
    expect(countWords("こんにちは 世界")).toBe(7);
    expect(countWords("안녕하세요")).toBe(5);
  });

  it("ignores punctuation and whitespace", () => {
    expect(countWords("你好，世界！")).toBe(4);
    expect(countWords("a, b; c\n\td")).toBe(4);
    expect(countWords("—— ……")).toBe(0);
    expect(countWords("")).toBe(0);
  });

  it("does not strip Markdown markup", () => {
    expect(countWords("# 标题")).toBe(2);
    expect(countWords("**bold**")).toBe(1);
    expect(countWords("[链接](url)")).toBe(3);
  });
});

describe("describeWordDifference", () => {
  it("reports more, fewer and equal words", () => {
    expect(describeWordDifference("一二三", "一")).toBe("多 2 字");
    expect(describeWordDifference("one", "one two")).toBe("少 1 字");
    expect(describeWordDifference("a, b", "ab cd")).toBe("字数相同");
  });
});
