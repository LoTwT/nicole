export type SavePhase = "idle" | "editing" | "saving" | "saved" | "failed" | "mixed" | "paused";

export type BannerKind =
  | "deleted"
  | "external-modified"
  | "save-failed"
  | "mixed-line-endings"
  | "single-file"
  | "restored";

export interface BannerInput {
  deleted: boolean;
  externallyModified: boolean;
  saveError: string | null;
  saveErrorDetail?: string | null;
  mixedLineEndings: boolean;
  singleFile: boolean;
  restored?: boolean;
}

export interface Banner {
  kind: BannerKind;
  message: string;
  tone: "danger" | "warning" | "info";
  actions: readonly (
    | "retry"
    | "load-disk"
    | "keep-mine"
    | "resave"
    | "close-tab"
    | "keep-restored"
    | "use-disk"
  )[];
  /** Raw backend detail; shown as a tooltip, not as the banner text. */
  detail?: string;
}

/**
 * Turns a backend save error into a short interface message. The raw error is
 * kept separately for the tooltip; common filesystem failures must not expose
 * English Go text in the banner.
 */
export function saveFailureMessage(error: string): string {
  const text = error.toLowerCase();
  if (
    text.includes("read-only") ||
    text.includes("readonly") ||
    text.includes("read only file system")
  ) {
    return "文件是只读的，无法保存";
  }
  if (
    text.includes("permission denied") ||
    text.includes("operation not permitted") ||
    text.includes("access denied")
  ) {
    return "没有权限保存这个文件";
  }
  if (
    text.includes("no space left") ||
    text.includes("disk full") ||
    text.includes("quota exceeded")
  ) {
    return "磁盘空间不足，无法保存";
  }
  if (
    text.includes("no such file") ||
    text.includes("not exist") ||
    text.includes("file not found")
  ) {
    return "文件已被删除或移走，无法保存";
  }
  if (
    text.includes("outside the folder") ||
    text.includes("outside the workspace") ||
    text.includes("path is outside")
  ) {
    return "文件路径超出工作区，无法保存";
  }
  if (text.includes("folder changed") || text.includes("generation")) {
    return "工作区已切换，无法保存到原文件";
  }
  if (text.includes("not a regular file")) {
    return "文件类型发生变化，无法保存";
  }
  return "保存失败，请稍后重试";
}

/**
 * At most one banner is shown per document. The order follows ui.md: external
 * deletion, external modification, save failure, recovery, mixed line
 * endings, then a file outside the workspace.
 */
export function selectBanner(input: BannerInput): Banner | null {
  if (input.deleted) {
    return {
      kind: "deleted",
      tone: "danger",
      message:
        "此文件已在磁盘上被删除或移走，内容仍保留在这个标签页中",
      actions: ["resave", "close-tab"],
    };
  }
  if (input.externallyModified) {
    return {
      kind: "external-modified",
      tone: "warning",
      message: "此文件已在 Nicole 之外被修改",
      actions: ["load-disk", "keep-mine"],
    };
  }
  if (input.saveError !== null) {
    return {
      kind: "save-failed",
      tone: "danger",
      message: input.saveError,
      detail: input.saveErrorDetail ?? undefined,
      actions: ["retry"],
    };
  }
  if (input.restored) {
    return {
      kind: "restored",
      tone: "warning",
      message: "这是恢复的内容",
      actions: ["keep-restored", "use-disk"],
    };
  }
  if (input.mixedLineEndings) {
    return {
      kind: "mixed-line-endings",
      tone: "warning",
      message: "换行风格混合，未自动保存；切换或关闭时可以放弃更改",
      actions: [],
    };
  }
  if (input.singleFile) {
    return {
      kind: "single-file",
      tone: "info",
      message: "这个文件不在已打开的文件夹中",
      actions: [],
    };
  }
  return null;
}

export interface SaveStatusPresentation {
  label: string;
  tone: "muted" | "success" | "warning" | "danger";
}

export function saveStatusPresentation(
  phase: SavePhase,
  mixed: boolean,
): SaveStatusPresentation | null {
  if (mixed) {
    return { label: "换行风格混合，未自动保存", tone: "warning" };
  }
  switch (phase) {
    case "editing":
      return { label: "编辑中", tone: "muted" };
    case "saving":
      return { label: "保存中", tone: "muted" };
    case "saved":
      return { label: "已保存", tone: "success" };
    case "failed":
      return { label: "保存失败", tone: "danger" };
    case "paused":
      return { label: "已暂停自动保存", tone: "warning" };
    case "idle":
      return null;
  }
  return null;
}

/** The tab's dot, shown only for states the user has to resolve. */
export function tabProblem(
  deleted: boolean,
  mixed: boolean,
  failed: boolean,
): "danger" | "warning" | null {
  if (deleted || failed) {
    return "danger";
  }
  if (mixed) {
    return "warning";
  }
  return null;
}
