export type LineEnding = "\n" | "\r\n" | "\r";

export interface LineEndingInfo {
  ending: LineEnding;
  mixed: boolean;
}

/**
 * Reports the line-ending style of a file read by Go. CodeMirror normalizes
 * line breaks to "\n", so a save must restore the file's own style.
 */
export function detectLineEndings(text: string): LineEndingInfo {
  const styles = new Set<LineEnding>();
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n") {
        styles.add("\r\n");
        index++;
      } else {
        styles.add("\r");
      }
    } else if (text[index] === "\n") {
      styles.add("\n");
    }
  }
  if (styles.size === 0) {
    return { ending: "\n", mixed: false };
  }
  return { ending: [...styles][0]!, mixed: styles.size > 1 };
}

/** Returns the text with CodeMirror's normalized line breaks. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Writes text using the line-ending style the file had when it was read. */
export function withLineEnding(text: string, ending: LineEnding): string {
  const normalized = normalizeLineEndings(text);
  return ending === "\n" ? normalized : normalized.replace(/\n/g, ending);
}
