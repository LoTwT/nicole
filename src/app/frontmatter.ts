import {
  CST,
  Document,
  Pair,
  Scalar,
  YAMLMap,
  isMap,
  isNode,
  isScalar,
  parseDocument,
  type Node,
} from "yaml";

export type FrontmatterValueKind = "text" | "boolean" | "number" | "yaml";
export interface FrontmatterField {
  id: number;
  key: string;
  kind: FrontmatterValueKind;
  value: string;
}
export interface FrontmatterDraft {
  source: string;
  from: number;
  to: number;
  yaml: string;
  newline: string;
  closing: string;
  fields: FrontmatterField[];
}

function fieldValue(value: unknown): Pick<FrontmatterField, "kind" | "value"> {
  if (isScalar(value)) {
    if (typeof value.value === "string")
      return { kind: "text", value: value.value };
    if (typeof value.value === "boolean")
      return { kind: "boolean", value: String(value.value) };
    if (typeof value.value === "number")
      return { kind: "number", value: String(value.value) };
  }
  return {
    kind: "yaml",
    value: new Document(value).toString({ verifyAliasOrder: false }).trimEnd(),
  };
}

function parseMapping(source: string): Document {
  const doc: Document = parseDocument(source, {
    keepSourceTokens: true,
    uniqueKeys: true,
  });
  if (doc.errors.length || doc.warnings.length)
    throw new Error(doc.errors[0]?.message ?? doc.warnings[0]!.message);
  if (doc.contents !== null && !isMap(doc.contents))
    throw new Error("Frontmatter 顶层必须是字段映射，请改用源码编辑。");
  return doc;
}

/** Read only the leading YAML block. A form never guesses at an unclosed block. */
export function readFrontmatter(source: string): FrontmatterDraft {
  const opening = /^(\uFEFF?---[ \t]*)(\r\n|\n|\r)/.exec(source);
  const newline = opening?.[2] ?? /\r\n|\n|\r/.exec(source)?.[0] ?? "\n";
  let yaml = "",
    from = source.startsWith("\uFEFF") ? 1 : 0,
    to = from,
    closing = "---";
  if (opening) {
    const bodyStart = opening[0].length;
    const end = /^(---|\.\.\.)[ \t]*(?:\r\n|\n|\r|$)/gm;
    end.lastIndex = bodyStart;
    const match = end.exec(source);
    if (!match)
      throw new Error("Frontmatter 缺少结束标记，请先在源码中补上 ---。");
    yaml = source.slice(bodyStart, match.index);
    from = 0;
    to = match.index + match[0].length;
    closing = match[1]!;
  }
  if (yaml.length > 64 * 1024)
    throw new Error("Frontmatter 较大，请直接编辑源码。");
  const doc = parseMapping(yaml);
  doc.toJS({ maxAliasCount: 100 });
  const pairs = isMap(doc.contents) ? doc.contents.items : [];
  if (pairs.length > 200)
    throw new Error("Frontmatter 字段较多，请直接编辑源码。");
  const fields = pairs.map((pair, id) => {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string")
      throw new Error("字段名必须是文字，请改用源码编辑。");
    return { id, key: pair.key.value, ...fieldValue(pair.value) };
  });
  return { source, from, to, yaml, newline, closing, fields };
}

function valueNode(doc: Document, field: FrontmatterField) {
  if (field.kind === "text") return doc.createNode(field.value);
  if (field.kind === "boolean") {
    if (field.value !== "true" && field.value !== "false")
      throw new Error(`“${field.key}”应为 true 或 false。`);
    return doc.createNode(field.value === "true");
  }
  if (field.kind === "number") {
    if (!field.value.trim() || !Number.isFinite(Number(field.value)))
      throw new Error(`“${field.key}”应为有限数字。`);
    return doc.createNode(Number(field.value));
  }
  const parsed = parseDocument(field.value, { uniqueKeys: true });
  if (parsed.errors.length || parsed.warnings.length)
    throw new Error(
      `“${field.key}”的 YAML 无效：${parsed.errors[0]?.message ?? parsed.warnings[0]!.message}`,
    );
  return parsed.contents?.clone() ?? doc.createNode(null);
}

interface SourceEdit {
  from: number;
  to: number;
  insert: string;
}

function serializePair(doc: Document, field: FrontmatterField): string {
  const fragment = new Document();
  const map = new YAMLMap<unknown, unknown>(fragment.schema);
  map.items = [new Pair(fragment.createNode(field.key), valueNode(doc, field))];
  fragment.contents = map;
  return fragment.toString({ lineWidth: 0, verifyAliasOrder: false });
}

function scalarSource(node: Node, field: FrontmatterField): string | null {
  if (field.kind === "yaml" || !node.srcToken || !CST.isScalar(node.srcToken))
    return null;
  // Use the schema-aware AST to validate typed input, but retain original
  // token whitespace/comments through the library's public CST API.
  const token = structuredClone(node.srcToken);
  const type =
    field.kind === "text"
      ? isScalar(node) &&
        [
          Scalar.QUOTE_SINGLE,
          Scalar.QUOTE_DOUBLE,
          Scalar.BLOCK_LITERAL,
          Scalar.BLOCK_FOLDED,
        ].includes(node.type!)
        ? node.type!
        : Scalar.QUOTE_DOUBLE
      : Scalar.PLAIN;
  const value =
    field.kind === "number" ? String(Number(field.value)) : field.value;
  CST.setScalarValue(token, value, { afterKey: true, type });
  return CST.stringify(token);
}

function sourceValue(
  doc: Document,
  original: Node,
  field: FrontmatterField,
  source: string,
): string {
  const next = valueNode(doc, field);
  // Properties preceding the original value belong to the original CST
  // separator. Keep its anchor name so existing aliases remain attached.
  if (
    field.kind === "yaml" &&
    "anchor" in original &&
    original.anchor &&
    (!("anchor" in next) || next.anchor !== original.anchor)
  )
    throw new Error(`“${field.key}”的根锚点更改请使用源码编辑。`);
  if (field.kind === "yaml" && original.tag && next.tag !== original.tag)
    throw new Error(`“${field.key}”的显式标签更改请使用源码编辑。`);
  if ("anchor" in next && next.anchor) {
    if (!("anchor" in original) || next.anchor !== original.anchor)
      throw new Error(`“${field.key}”的根锚点更改请使用源码编辑。`);
    next.anchor = undefined;
  }
  if (next.tag) {
    if (next.tag !== original.tag)
      throw new Error(`“${field.key}”的显式标签更改请使用源码编辑。`);
    next.tag = undefined;
  }
  if (
    field.kind === "yaml" &&
    (next.comment ?? "") !== (original.comment ?? "")
  )
    throw new Error(`“${field.key}”的尾部注释更改请使用源码编辑。`);
  if (
    field.kind === "yaml" &&
    (next.commentBefore ?? "") !== (original.commentBefore ?? "")
  )
    throw new Error(`“${field.key}”的前置注释更改请使用源码编辑。`);
  // These comments remain in the original source outside the value range.
  next.comment = undefined;
  next.commentBefore = undefined;
  if (isScalar(next) && typeof next.value === "string")
    next.type = Scalar.QUOTE_DOUBLE;
  const fragment = new Document(next);
  const rendered = fragment
    .toString({
      collectionStyle: "flow",
      lineWidth: 0,
      verifyAliasOrder: false,
    })
    .replace(/\n$/, "");
  const [from, to] = original.range!;
  const column =
    from -
    Math.max(
      source.lastIndexOf("\n", from - 1),
      source.lastIndexOf("\r", from - 1),
    ) -
    1;
  const newline = /\r\n|\n|\r/.exec(source)?.[0] ?? "\n";
  const oldEnding = /(?:\r\n|\n|\r)+$/.exec(source.slice(from, to))?.[0] ?? "";
  return rendered.replace(/\n/g, newline + " ".repeat(column)) + oldEnding;
}

/** Apply disjoint library-provided ranges without reserializing other pairs. */
function patchMapping(
  draft: FrontmatterDraft,
  fields: readonly FrontmatterField[],
  doc: Document,
): string {
  const original = isMap(doc.contents) ? doc.contents.items : [];
  const retained = fields.filter((field) =>
    draft.fields.some((item) => item.id === field.id),
  );
  const expectedOrder = draft.fields
    .filter((field) => fields.some((item) => item.id === field.id))
    .map((field) => field.id);
  if (retained.some((field, index) => field.id !== expectedOrder[index]))
    throw new Error("字段重排请使用源码编辑。");
  const added = fields.filter(
    (field) => !draft.fields.some((item) => item.id === field.id),
  );
  const removed = draft.fields.filter(
    (field) => !fields.some((item) => item.id === field.id),
  );
  if (
    isMap(doc.contents) &&
    doc.contents.flow &&
    (added.length || removed.length)
  )
    throw new Error("顶层行内映射的新增或删除字段请使用源码编辑。");
  const edits: SourceEdit[] = [];
  for (const initial of draft.fields) {
    const existing = original[initial.id];
    if (
      !existing ||
      !isScalar(existing.key) ||
      !existing.key.range ||
      !isNode(existing.value) ||
      !existing.value.range
    )
      throw new Error("无法确定字段的源码范围，请使用源码编辑。");
    const field = fields.find((item) => item.id === initial.id);
    if (!field) {
      if (
        existing.srcToken?.start.some(
          (token) => token.type === "explicit-key-ind",
        )
      )
        throw new Error("显式 YAML key 的删除请使用源码编辑。");
      let from = existing.key.range[0];
      const lineStart =
        Math.max(
          draft.yaml.lastIndexOf("\n", from - 1),
          draft.yaml.lastIndexOf("\r", from - 1),
        ) + 1;
      if (/^[ \t]*$/.test(draft.yaml.slice(lineStart, from))) from = lineStart;
      edits.push({ from, to: existing.value.range[2], insert: "" });
      continue;
    }
    if (field.key !== initial.key) {
      const key = CST.createScalarToken(field.key, {
        indent: 0,
        implicitKey: true,
        type: Scalar.QUOTE_DOUBLE,
        end: [],
      });
      edits.push({
        from: existing.key.range[0],
        to: existing.key.range[1],
        insert: CST.stringify(key),
      });
    }
    if (field.kind === initial.kind && field.value === initial.value) continue;
    valueNode(doc, field);
    for (const token of existing.srcToken?.sep ?? []) {
      // Explicitly changing the value type must not retain an old !!str tag.
      if (token.type === "tag" && field.kind !== "yaml")
        edits.push({
          from: token.offset,
          to: token.offset + token.source.length,
          insert: "",
        });
    }
    const scalar = scalarSource(existing.value, field);
    if (scalar !== null) {
      edits.push({
        from: existing.value.range[0],
        to: existing.value.range[2],
        insert: scalar.replace(/\r?\n/g, draft.newline),
      });
    } else {
      if (existing.value.srcToken?.type === "block-scalar")
        throw new Error(`“${field.key}”的块文本类型更改请使用源码编辑。`);
      const from = existing.value.range[0],
        to = existing.value.range[1];
      let insert = sourceValue(doc, existing.value, field, draft.yaml);
      if (from === to) {
        if (!/[ \t\r\n]$/.test(draft.yaml.slice(0, from)))
          insert = " " + insert;
        if (draft.yaml[from] === "#") insert += " ";
      }
      edits.push({ from, to, insert });
    }
  }
  let yaml = draft.yaml;
  for (const edit of edits.sort((a, b) => b.from - a.from || b.to - a.to))
    yaml = yaml.slice(0, edit.from) + edit.insert + yaml.slice(edit.to);
  for (const field of added) {
    if (yaml.length && !/[\r\n]$/.test(yaml)) yaml += draft.newline;
    const indent =
      isMap(doc.contents) && doc.contents.srcToken?.type === "block-map"
        ? doc.contents.srcToken.indent
        : 0;
    const fragment = serializePair(doc, field)
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => " ".repeat(indent) + line)
      .join(draft.newline);
    yaml += fragment + draft.newline;
  }
  return yaml;
}

/** Explicit Apply changes the metadata block only; a no-op remains byte exact. */
export function applyFrontmatter(
  draft: FrontmatterDraft,
  fields: readonly FrontmatterField[],
): { from: number; to: number; insert: string } | null {
  if (fields.length > 200)
    throw new Error("最多编辑 200 个 Frontmatter 字段。");
  if (JSON.stringify(fields) === JSON.stringify(draft.fields)) return null;
  const keys = new Set<string>();
  const ids = new Set<number>();
  for (const field of fields) {
    if (!Number.isInteger(field.id) || ids.has(field.id))
      throw new Error("字段标识无效或重复，请重新打开表单。");
    ids.add(field.id);
    if (!field.key.trim()) throw new Error("字段名不能为空。");
    if (keys.has(field.key)) throw new Error(`字段名“${field.key}”重复。`);
    keys.add(field.key);
  }
  const doc = parseMapping(draft.yaml);
  const yaml = patchMapping(draft, fields, doc);
  if (yaml.length > 64 * 1024)
    throw new Error("Frontmatter 超过可视编辑大小，请直接编辑源码。");
  // Validate anchors and aliases after deleting or replacing fields.
  const checked = parseMapping(yaml);
  checked.toJS({ maxAliasCount: 100 });
  let insert: string;
  if (draft.from === draft.to) {
    insert =
      "---" +
      draft.newline +
      yaml +
      draft.closing +
      draft.newline +
      draft.newline;
  } else {
    const opening = /^(\uFEFF?---[ \t]*)(\r\n|\n|\r)/.exec(draft.source)!;
    insert =
      draft.source.slice(draft.from, opening[0].length) +
      yaml +
      draft.source.slice(opening[0].length + draft.yaml.length, draft.to);
  }
  return { from: draft.from, to: draft.to, insert };
}
