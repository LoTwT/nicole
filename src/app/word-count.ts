const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
const COMBINING_MARK = /\p{M}/u;

/**
 * Counts words with the rule the recovery dialog and, later, the status bar
 * share: every CJK character counts once; other letters and digits count once
 * per uninterrupted run; whitespace and punctuation do not count. Markdown
 * markup is not stripped.
 */
export function countWords(text: string): number {
  let count = 0;
  let inRun = false;
  for (const char of text) {
    if (CJK.test(char)) {
      count += 1;
      inRun = false;
      continue;
    }
    if (LETTER_OR_NUMBER.test(char)) {
      if (!inRun) {
        count += 1;
        inRun = true;
      }
      continue;
    }
    if (COMBINING_MARK.test(char)) {
      // A mark belongs to the preceding letter; on its own it is not a word.
      continue;
    }
    inRun = false;
  }
  return count;
}

/** Describes the copy's word count relative to the disk version. */
export function describeWordDifference(
  recovered: string,
  disk: string,
): string {
  const difference = countWords(recovered) - countWords(disk);
  if (difference > 0) {
    return `多 ${difference} 字`;
  }
  if (difference < 0) {
    return `少 ${-difference} 字`;
  }
  return "字数相同";
}
