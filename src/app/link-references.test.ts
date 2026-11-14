import { describe, expect, it } from "vitest";

import { planLinkReferenceUpdates } from "./link-references";

function rewrite(
  content: string,
  source = "notes/source.md",
  oldPath = "notes/target.md",
  newPath = "notes/new name.md",
  isDir = false,
) {
  return (
    planLinkReferenceUpdates(
      [{ path: source, content }],
      oldPath,
      newPath,
      isDir,
    )[0]?.updatedContent ?? content
  );
}

describe("workspace link reference plans", () => {
  it("changes only parsed destinations and preserves title, label, fragment and CRLF bytes", () => {
    const text =
      "\uFEFF[x](target.md#A%20B \"unchanged\")\r\n![alt](<target.md#标题>)\r\n\r\n[r]: target.md 'title'\r\n";
    expect(rewrite(text)).toBe(
      "\uFEFF[x](new%20name.md#A%20B \"unchanged\")\r\n![alt](<new%20name.md#标题>)\r\n\r\n[r]: new%20name.md 'title'\r\n",
    );
  });

  it("leaves code, metadata, HTML destinations, text and external URLs alone", () => {
    const text =
      '---\nurl: [x](target.md)\n---\n\n`[x](target.md)`\n\n```md\n[x](target.md)\n```\n\n<a href="target.md">text</a>\n\n[web](https://example.com/target.md) target.md\n';
    expect(rewrite(text)).toBe(text);
    expect(rewrite("---\nurl: [x](target.md)")).toBe(
      "---\nurl: [x](target.md)",
    );
    expect(rewrite("---\ntext: |\n  ```\n---\n\n[x](target.md)")).toBe(
      "---\ntext: |\n  ```\n---\n\n[x](new%20name.md)",
    );
  });

  it("rebases incoming and outgoing links for a moved directory, including images", () => {
    const documents = [
      { path: "outside.md", content: "[in](notes/sub/a.md#anchor)" },
      {
        path: "notes/sub/a.md",
        content:
          "[same](../b.md) [out](../../outside.md) ![img](../../assets/a.png) [root](/notes/b.md)",
      },
    ];
    const plan = planLinkReferenceUpdates(documents, "notes", "renamed", true);
    expect(plan[0]!.updatedContent).toBe("[in](renamed/sub/a.md#anchor)");
    expect(plan[1]!.newPath).toBe("renamed/sub/a.md");
    expect(plan[1]!.updatedContent).toBe(
      "[same](../b.md) [out](../../outside.md) ![img](../../assets/a.png) [root](/renamed/b.md)",
    );
    expect(
      rewrite(
        "[out](../target.md)",
        "notes/source.md",
        "notes",
        "deep/notes",
        true,
      ),
    ).toBe("[out](../../target.md)");
  });

  it("matches decoded escapes, angle spaces and encoded punctuation without changing fragment source", () => {
    expect(
      rewrite(
        '[x](target\\(1\\).md&#35;part "title")',
        "notes/a.md",
        "notes/target(1).md",
        "notes/new[2].md",
      ),
    ).toBe('[x](new%5B2%5D.md&#35;part "title")');
    expect(
      rewrite(
        "[x](<target name.md>)",
        "notes/a.md",
        "notes/target name.md",
        "notes/new.md",
      ),
    ).toBe("[x](<new.md>)");
    expect(
      rewrite(
        "[x](target%23name.md#frag)",
        "notes/a.md",
        "notes/target#name.md",
        "notes/a&b.md",
      ),
    ).toBe("[x](a%26b.md#frag)");
  });

  it("keeps unsupported or escaping paths and unrelated byte spellings untouched", () => {
    const source =
      "[x](../../../target.md) [x](bad%2Ftarget.md) [x](target.md?x=1) [x](C:/target.md) [x](#local)";
    expect(rewrite(source)).toBe(source);
    expect(
      rewrite(
        "[x](./other%20file.md)",
        "notes/source.md",
        "notes/source.md",
        "notes/renamed.md",
      ),
    ).toBe("[x](./other%20file.md)");
  });

  it("plans independent dirty overlays and returns original UTF-16 edit coordinates", () => {
    const dirty = "😀 unsaved [x](target.md)";
    const update = planLinkReferenceUpdates(
      [{ path: "notes/a.md", content: dirty }],
      "notes/target.md",
      "notes/new.md",
      false,
    )[0]!;
    expect(update.content).toBe(dirty);
    expect(dirty.slice(update.edits[0]!.from, update.edits[0]!.to)).toBe(
      "target.md",
    );
    expect(update.updatedContent).toBe("😀 unsaved [x](new.md)");
  });
});
