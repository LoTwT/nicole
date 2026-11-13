/**
 * Splits the Unicode whitespace at both edges from the text that markers wrap.
 * `String.trim` and `\\s` share the Unicode whitespace definition here, so
 * qualification and marker placement cannot disagree on U+3000, NBSP and the
 * other non-ASCII spaces.
 */
export interface EdgeWhitespace {
  leading: string;
  trailing: string;
  core: string;
}

export function splitEdgeWhitespace(text: string): EdgeWhitespace {
  const leading = /^\s*/.exec(text)?.[0] ?? "";
  const rest = text.slice(leading.length);
  const trailing = /\s*$/.exec(rest)?.[0] ?? "";
  return {
    leading,
    trailing,
    core: rest.slice(0, rest.length - trailing.length),
  };
}
