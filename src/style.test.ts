// @ts-expect-error The test environment runs on Node, but the project does not
// install Node type declarations for the browser-only TypeScript config.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleCss = readFileSync("src/style.css", "utf8");
const zIndexCss = readFileSync(
  "node_modules/@ayingott/theme/src/layers/z-index.css",
  "utf8",
);

function zIndex(name: string): number {
  const match = zIndexCss.match(new RegExp(`${name}:\\s*(\\d+);`));
  if (!match) {
    throw new Error(`missing ${name}`);
  }
  return Number(match[1]);
}

// jsdom does not resolve Vite's CSS imports; the rest of the stylesheet is
// enough to let its cascade decide the sidebar's position.
const cascadeCss = styleCss.replace(/^@import[^;]+;\s*$/gm, "");

function computedPosition(classNames: string): string {
  const style = document.createElement("style");
  style.textContent = cascadeCss;
  document.head.append(style);
  const aside = document.createElement("aside");
  aside.className = classNames;
  document.body.append(aside);
  const position = getComputedStyle(aside).position;
  aside.remove();
  style.remove();
  return position;
}

describe("floating layer contract", () => {
  it("keeps the overlay sidebar below the palette scrim and dialogs", () => {
    expect(styleCss).toMatch(
      /\.sidebar--overlay\s*\{[^}]*z-index:\s*var\(--z-header\)/s,
    );
    expect(zIndex("--z-header")).toBeLessThan(zIndex("--z-overlay"));
    expect(zIndex("--z-header")).toBeLessThan(zIndex("--z-modal"));
  });

  it("keeps the overlay sidebar out of the layout cascade", () => {
    expect(computedPosition("sidebar")).toBe("relative");
    expect(computedPosition("sidebar sidebar--overlay")).toBe("absolute");
  });
});

describe("primary button contract", () => {
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, "");

  function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) {
      throw new Error(`missing selector: ${selector}`);
    }
    const end = css.indexOf("}", start);
    return css.slice(start, end + 1);
  }

  function braceDepthAt(index: number): number {
    let depth = 0;
    for (let position = 0; position < index; position++) {
      const character = css.charAt(position);
      if (character === "{") depth++;
      else if (character === "}") depth--;
    }
    return depth;
  }

  it("switches the accent fill, border and content color together", () => {
    expect(rule(".button-primary")).toMatch(
      /border-color:\s*var\(--accent-primary\);/,
    );
    expect(rule(".button-primary")).toMatch(
      /background-color:\s*var\(--accent-primary\);/,
    );
    expect(rule(".button-primary")).toMatch(
      /color:\s*var\(--accent-contrast\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /border-color:\s*var\(--accent-primary-hover\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /background-color:\s*var\(--accent-primary-hover\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /color:\s*var\(--accent-contrast-hover\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /border-color:\s*var\(--accent-primary-active\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /background-color:\s*var\(--accent-primary-active\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /color:\s*var\(--accent-contrast-active\);/,
    );
    // Only the color is shared; width and style stay with the component so a
    // borderless button does not gain a border or change size.
    expect(rule(".button-primary")).not.toMatch(/border-(width|style):/);
  });

  it("keeps hover before active and both rules out of any layer", () => {
    const base = css.indexOf(".button-primary {");
    const hover = css.indexOf(".button-primary:hover:not(:disabled) {");
    const active = css.indexOf(".button-primary:active:not(:disabled) {");
    expect(base).toBeGreaterThan(-1);
    expect(hover).toBeGreaterThan(base);
    expect(active).toBeGreaterThan(hover);
    // A depth of zero means the rules are not nested in @layer, @media, etc.
    expect(braceDepthAt(base)).toBe(0);
    expect(braceDepthAt(hover)).toBe(0);
    expect(braceDepthAt(active)).toBe(0);
  });
});
