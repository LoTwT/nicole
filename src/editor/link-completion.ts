import {
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";

import {
  encodeWorkspaceLinkPath,
  relativeWorkspaceLinkPath,
} from "../app/link-references";

export interface WorkspaceLinkCompletionOptions {
  /** Null for single-file tabs, previews, and while a workspace is changing. */
  getSource(): string | null;
  /** The current workspace's existing, authorized Markdown file listing. */
  getFiles(): readonly string[];
  /** Root/generation or tab identity; stale menus must not cross an owner. */
  getIdentity?(): unknown;
}

const EXCLUDED =
  /^(?:FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|Comment|CommentBlock|ProcessingInstruction|ProcessingInstructionBlock|Frontmatter|YAMLFrontmatter|CodeText)$/;

function metadataEnd(state: EditorState): number {
  if (!/^(?:\uFEFF)?---[ \t]*$/.test(state.doc.line(1).text)) return 0;
  for (let number = 2; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (/^(?:---|\.\.\.)[ \t]*$/.test(line.text)) return line.to;
  }
  return state.doc.length;
}

function excludedContext(context: CompletionContext): boolean {
  if (context.view?.composing || context.view?.compositionStarted) return true;
  if (
    context.state.selection.ranges.length !== 1 ||
    !context.state.selection.main.empty
  )
    return true;
  const end = metadataEnd(context.state);
  if (end > 0 && context.pos <= end) return true;
  const tree = ensureSyntaxTree(context.state, context.pos, 10);
  if (!tree) return true;
  for (
    let node = tree.resolveInner(context.pos, -1);
    node;
    node = node.parent!
  ) {
    if (EXCLUDED.test(node.name)) return true;
  }
  return false;
}

function escapedAt(value: string, position: number): boolean {
  let backslashes = 0;
  while (position > 0 && value[--position] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

/** Both trigger forms produce ordinary Markdown source; no wiki syntax persists. */
export function createWorkspaceLinkCompletionSource(
  options: WorkspaceLinkCompletionOptions,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const source = options.getSource();
    const identity = options.getIdentity?.();
    if (!source || excludedContext(context)) return null;
    const line = context.state.doc.lineAt(context.pos);
    const prefix = line.text.slice(0, context.pos - line.from);
    const wiki = /\[\[([^\[\]\r\n]*)$/.exec(prefix);
    const standard = /\]\((<?)([^\s<>()]*)$/.exec(prefix);
    const match = wiki ?? standard;
    if (
      !match ||
      escapedAt(prefix, match.index) ||
      (wiki && prefix[match.index - 1] === "!")
    )
      return null;
    const from = wiki
      ? line.from + match.index
      : context.pos - standard![2]!.length;
    const query = wiki ? wiki[1]! : standard![2]!;
    if (query.includes("#") || query.includes("?") || query.includes(":"))
      return null;
    if (!wiki) {
      // Incomplete destinations are plain text in the live tree. Close a
      // synthetic candidate and require a real parsed Link/Image URL, so a
      // stray `](` or an escaped label cannot summon filesystem candidates.
      let blockFrom = line.from;
      for (
        let node = syntaxTree(context.state).resolveInner(from, -1);
        node;
        node = node.parent!
      ) {
        if (
          /^(?:Paragraph|ATXHeading[1-6]|SetextHeading[12])$/.test(node.name)
        ) {
          blockFrom = node.from;
          break;
        }
      }
      if (
        context.pos - blockFrom > 64 * 1024 ||
        line.to - blockFrom > 64 * 1024
      )
        return null;
      const before = context.state.doc.sliceString(blockFrom, from);
      const suffix = context.state.doc.sliceString(context.pos, line.to);
      const close = standard![1] ? ">)" : ")";
      const synthetic = before + "nicole-completion.md" + close + suffix;
      let valid = false;
      markdownLanguage.parser.parse(synthetic).iterate({
        enter(node) {
          if (
            node.name === "URL" &&
            node.from + blockFrom <= from &&
            node.to + blockFrom > from &&
            ["Link", "Image"].includes(node.node.parent?.name ?? "")
          )
            valid = true;
        },
      });
      if (!valid) return null;
    }
    let decodedQuery = query;
    try {
      decodedQuery = decodeURIComponent(query);
    } catch {
      /* An incomplete percent escape can still be typed. */
    }
    const lowered = decodedQuery.toLocaleLowerCase();
    const files = [...new Set(options.getFiles())]
      .filter(
        (file) =>
          /\.md$/i.test(file) &&
          !file.startsWith("/") &&
          !/[\u0000-\u001F\u007F\\:]/.test(file) &&
          file
            .split("/")
            .every(
              (part, index, parts) =>
                part !== "" &&
                part !== "." &&
                part !== ".." &&
                (index === parts.length - 1 ||
                  (!part.startsWith(".") && part !== "node_modules")),
            ),
      )
      .filter(
        (file) =>
          file.toLocaleLowerCase().includes(lowered) ||
          relativeWorkspaceLinkPath(source, file)
            .toLocaleLowerCase()
            .startsWith(lowered),
      )
      .slice(0, 100);
    const tail = context.state.doc.sliceString(context.pos, line.to);
    const rest = (wiki ? /^[^\[\]\r\n]*/ : /^[^\s<>()]*/).exec(tail)![0];
    return {
      from,
      to: context.pos + rest.length,
      filter: false,
      options: files.map((file) => ({
        label: file,
        type: "text",
        detail: "工作区文件",
        apply(view, _completion, start, end) {
          if (
            view.composing ||
            view.compositionStarted ||
            options.getSource() !== source ||
            options.getIdentity?.() !== identity ||
            !options.getFiles().includes(file)
          )
            return;
          if (
            wiki
              ? view.state.sliceDoc(start, start + 2) !== "[["
              : view.state.sliceDoc(start - 2, start) !==
                (standard![1] ? "(<" : "](")
          )
            return;
          const destination = encodeWorkspaceLinkPath(
            relativeWorkspaceLinkPath(source, file),
          );
          let to = end;
          let insert: string;
          if (wiki) {
            if (view.state.sliceDoc(to, to + 2) === "]]") to += 2;
            const label = file
              .split("/")
              .at(-1)!
              .replace(/\.md$/i, "")
              .replace(/[!-/:-@[-`{-~]/g, "\\$&");
            insert = `[${label}](${destination})`;
          } else {
            const angle = standard![1] === "<";
            const closing = angle ? ">)" : ")";
            const tail = view.state.sliceDoc(to, to + closing.length);
            insert = destination;
            if (
              tail !== closing &&
              !/^(?:\s+["'(]|[>)])/.test(view.state.sliceDoc(to, to + 2))
            )
              insert += closing;
          }
          view.dispatch({
            changes: { from: start, to, insert },
            selection: { anchor: start + insert.length },
            userEvent: "input.complete",
          });
        },
      })),
    };
  };
}

/** basicSetup owns the completion UI; language data adds only this source. */
export function workspaceLinkCompletion(
  options: WorkspaceLinkCompletionOptions,
): Extension {
  const source = createWorkspaceLinkCompletionSource(options);
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
