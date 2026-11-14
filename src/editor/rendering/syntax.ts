import type { Element, MarkdownConfig } from "@lezer/markdown";
import type { Input } from "@lezer/common";
import { tags } from "@lezer/highlight";

let advancingInput: Input | null = null;

function continuationStart(text: string, prefix: string): number | null {
  if (!text.trim() && !prefix.includes(">")) return text.length;
  let at = 0;
  for (let index = 0; index < prefix.length;) {
    if (prefix[index] === ">") {
      let extra = 0;
      while (text[at] === " " && extra++ < 3) at++;
      if (text[at++] !== ">") return null;
      index++;
      if (prefix[index] === " ") {
        if (text[at] === " " || text[at] === "\t") at++;
        index++;
      }
    } else {
      const start = index;
      while (prefix[index] === " ") index++;
      const required = index - start;
      let width = 0;
      while (width < required && (text[at] === " " || text[at] === "\t")) {
        width += text[at++] === "\t" ? 4 - width % 4 : 1;
      }
      if (width < required) return null;
    }
  }
  return at;
}

function continuationPrefix(prefix: string): string {
  let column = 0;
  return prefix.replace(/./g, (character) => {
    const width = character === "\t" ? 4 - column % 4 : 1;
    column += width;
    return character === ">" ? ">" : " ".repeat(width);
  });
}

/** Dollar delimiters shared with the read-only Markdown renderer. */
export function inlineMathEnd(
  text: string,
  from: number,
): number | null {
  if (
    text[from] !== "$" ||
    text[from + 1] === "$" ||
    from > 0 && text[from - 1] === "$" ||
    !text[from + 1] ||
    /\s/.test(text[from + 1]!)
  ) return null;
  for (let end = from + 1; end < Math.min(text.length, from + 20_000); end++) {
    const ch = text[end];
    if (ch === "\n") return null;
    if (ch === "\\") {
      end++;
      continue;
    }
    if (
      ch === "$" &&
      !/\s/.test(text[end - 1]!) &&
      text[end + 1] !== "$" &&
      !/[0-9]/.test(text[end + 1] ?? "")
    ) return end + 1;
  }
  return null;
}

export const mathMarkdown: MarkdownConfig = {
  // A public parse wrapper exposes the source during synchronous advance,
  // including when parseCode's mixed-language wrapper surrounds BlockContext.
  // Restoring the previous input also handles reentrant nested parses. No
  // source is held between advances or accessed through private parser fields.
  wrap(parse, input) {
    return {
      get parsedPos() { return parse.parsedPos; },
      get stoppedAt() { return parse.stoppedAt; },
      stopAt(position) { parse.stopAt(position); },
      advance() {
        const previous = advancingInput;
        advancingInput = input;
        try {
          return parse.advance();
        } finally {
          advancingInput = previous;
        }
      },
    };
  },
  defineNodes: [
    { name: "InlineMath", style: tags.special(tags.string) },
    { name: "BlockMath", block: true, style: tags.special(tags.string) },
    { name: "MathMark", style: tags.processingInstruction },
    "MathText",
  ],
  parseInline: [{
    name: "InlineMath",
    after: "Escape",
    parse(cx, next, pos) {
      if (next !== 36) return -1;
      const end = inlineMathEnd(cx.text, pos - cx.offset);
      if (end === null) return -1;
      const to = cx.offset + end;
      return cx.addElement(cx.elt("InlineMath", pos, to, [
        cx.elt("MathMark", pos, pos + 1),
        cx.elt("MathText", pos + 1, to - 1),
        cx.elt("MathMark", to - 1, to),
      ]));
    },
  }],
  parseBlock: [{
    name: "BlockMath",
    before: "FencedCode",
    parse(cx, line) {
      if (
        line.indent - line.baseIndent > 3 ||
        line.text.slice(line.pos, line.pos + 2) !== "$$"
      ) return false;
      const from = cx.lineStart + line.pos;
      const rest = line.text.slice(line.pos + 2);
      const sameLine = rest.lastIndexOf("$$");
      if (sameLine >= 0 && rest.slice(sameLine + 2).trim() === "") {
        const close = from + 2 + sameLine;
        cx.addElement(cx.elt("BlockMath", from, close + 2, [
          cx.elt("MathMark", from, from + 2),
          cx.elt("MathText", from + 2, close),
          cx.elt("MathMark", close, close + 2),
        ]));
        cx.nextLine();
        return true;
      }
      if (rest.trim() !== "") return false;
      const input = advancingInput;
      if (!input) return false;
      const nextLineFrom = cx.lineStart + line.text.length + 1;
      const limit = Math.min(input.length, from + 20_000);
      if (nextLineFrom > limit) return false;
      const tail = input.read(
        Math.min(nextLineFrom, input.length),
        limit,
      );
      // Validate the closing line before advancing the live block context.
      // A dedent/missing quote marker ends this container, so an unrelated $$
      // later in the document cannot swallow following Markdown.
      const prefix = continuationPrefix(line.text.slice(0, line.basePos));
      let closingLineFrom = nextLineFrom;
      let close = -1;
      const following = tail.split("\n");
      for (let index = 0; index < following.length; index++) {
        const text = following[index]!;
        if (index === following.length - 1 && limit < input.length) break;
        const start = continuationStart(text, prefix);
        if (start === null) return false;
        if (/^ {0,3}\$\$[ \t]*\r?$/.test(text.slice(start))) {
          close = closingLineFrom + text.indexOf("$$", start);
          break;
        }
        closingLineFrom += text.length + 1;
      }
      if (close < 0) return false;
      const children: Element[] = [cx.elt("MathMark", from, from + 2)];
      let textFrom = from + 2;
      let textTo = cx.lineStart + line.text.length;
      const flush = () => {
        if (textTo > textFrom) children.push(cx.elt("MathText", textFrom, textTo));
      };
      const appendText = (start: number, end: number) => {
        if (start > textTo) { flush(); textFrom = start; }
        textTo = end;
      };
      while (cx.nextLine()) {
        appendText(cx.lineStart - 1, cx.lineStart);
        if (line.markers.length) {
          flush();
          children.push(...line.markers);
          textFrom = textTo = cx.lineStart + line.basePos;
        }
        if (cx.lineStart === closingLineFrom) {
          appendText(cx.lineStart + line.basePos, close);
          break;
        }
        appendText(cx.lineStart + line.basePos, cx.lineStart + line.text.length);
      }
      flush();
      children.push(cx.elt("MathMark", close, close + 2));
      cx.addElement(cx.elt("BlockMath", from, close + 2, children));
      cx.nextLine();
      return true;
    },
  }],
};

export const CALLOUT_LABELS: Readonly<Record<string, string>> = {
  note: "笔记",
  info: "信息",
  tip: "提示",
  important: "重要",
  warning: "警告",
  caution: "注意",
  danger: "危险",
  success: "成功",
  question: "问题",
  example: "示例",
  quote: "引用",
  abstract: "摘要",
  summary: "摘要",
  todo: "待办",
  bug: "问题",
  failure: "失败",
};

export function calloutHeading(text: string): {
  type: string;
  label: string;
  title: string;
  markerLength: number;
  fold: "+" | "-" | null;
} | null {
  const match = /^\[!([a-z]+)\]([+-])?(?:[ \t]+(.*))?$/i.exec(text);
  if (!match) return null;
  const type = match[1]!.toLowerCase();
  return {
    type: Object.hasOwn(CALLOUT_LABELS, type) ? type : "note",
    label: CALLOUT_LABELS[type] ?? type,
    title: match[3] ?? "",
    markerLength: match[1]!.length + 3 + (match[2] ? 1 : 0),
    fold: (match[2] as "+" | "-" | undefined) ?? null,
  };
}
