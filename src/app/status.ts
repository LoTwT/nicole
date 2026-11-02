export type SavePhase = "idle" | "editing" | "saving" | "saved" | "failed" | "mixed";

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
  mixedLineEndings: boolean;
  singleFile: boolean;
  restored?: boolean;
}

export interface Banner {
  kind: BannerKind;
  message: string;
  tone: "danger" | "warning" | "info";
  actions: readonly ("retry" | "load-disk" | "keep-mine" | "resave" | "close-tab")[];
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
      message: `无法保存：${input.saveError}`,
      actions: ["retry"],
    };
  }
  if (input.restored) {
    return {
      kind: "restored",
      tone: "warning",
      message: "这是恢复的内容",
      actions: [],
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
