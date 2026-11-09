// @ts-expect-error The test environment runs on Node, but the project does not
// install Node type declarations for the browser-only TypeScript config.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleCss = readFileSync("src/style.css", "utf8");
const zIndexCss = readFileSync(
  "node_modules/@ayingott/theme/src/layers/z-index.css",
  "utf8",
);
const themeColorsCss = readFileSync(
  "node_modules/@ayingott/theme/src/foundation/colors.css",
  "utf8",
);
const themeDarkCss = readFileSync(
  "node_modules/@ayingott/theme/src/semantic/dark.css",
  "utf8",
);
const themeLightCss = readFileSync(
  "node_modules/@ayingott/theme/src/semantic/light.css",
  "utf8",
);

function cssVariable(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, "i"));
  if (!match) {
    throw new Error(`missing color ${name}`);
  }
  return match[1]!;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  );
}

function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

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
      /border-color:\s*var\(--nicole-primary-fill\);/,
    );
    expect(rule(".button-primary")).toMatch(
      /background-color:\s*var\(--nicole-primary-fill\);/,
    );
    expect(rule(".button-primary")).toMatch(
      /color:\s*var\(--nicole-primary-content\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /border-color:\s*var\(--nicole-primary-fill-hover\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /background-color:\s*var\(--nicole-primary-fill-hover\);/,
    );
    expect(rule(".button-primary:hover:not(:disabled)")).toMatch(
      /color:\s*var\(--nicole-primary-content-hover\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /border-color:\s*var\(--nicole-primary-fill-active\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /background-color:\s*var\(--nicole-primary-fill-active\);/,
    );
    expect(rule(".button-primary:active:not(:disabled)")).toMatch(
      /color:\s*var\(--nicole-primary-content-active\);/,
    );
    // Only the color is shared; width and style stay with the component so a
    // borderless button does not gain a border or change size.
    expect(rule(".button-primary")).not.toMatch(/border-(width|style):/);
  });

  it("keeps the dark primary button readable and never dimmer when pressed", () => {
    const dark = rule(".dark");
    expect(dark).toMatch(
      /--nicole-primary-fill:\s*var\(--color-lavender-300\);/,
    );
    expect(dark).toMatch(
      /--nicole-primary-fill-hover:\s*var\(--color-lavender-200\);/,
    );
    expect(dark).toMatch(
      /--nicole-primary-fill-active:\s*var\(--color-lavender-100\);/,
    );
    expect(dark).toMatch(
      /--nicole-primary-content:\s*var\(--color-lavender-900\);/,
    );

    const canvas = cssVariable(themeDarkCss, "--surface-canvas");
    const fill = cssVariable(themeColorsCss, "--color-lavender-300");
    const hoverFill = cssVariable(themeColorsCss, "--color-lavender-200");
    const activeFill = cssVariable(themeColorsCss, "--color-lavender-100");
    const content = cssVariable(themeColorsCss, "--color-lavender-900");

    // The old dark fill was lavender-700 on the same canvas; this one is
    // clearly brighter, not just a different hue.
    const oldFill = cssVariable(themeColorsCss, "--color-lavender-700");
    expect(contrast(fill, canvas)).toBeGreaterThan(contrast(oldFill, canvas));
    expect(contrast(fill, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fill, content)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hoverFill, content)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(activeFill, content)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(hoverFill)).toBeGreaterThan(luminance(fill));
    expect(luminance(activeFill)).toBeGreaterThanOrEqual(luminance(fill));
  });

  it("strengthens only the light file tree selection", () => {
    const selected = rule(":root");
    expect(selected).toMatch(
      /--nicole-file-tree-selected:\s*var\(--color-lavender-200\);/,
    );
    expect(rule(".dark")).toMatch(
      /--nicole-file-tree-selected:\s*var\(--accent-soft\);/,
    );
    expect(css).not.toMatch(/--accent-soft\s*:/);

    const sidebar = cssVariable(themeColorsCss, "--color-surface-1");
    const oldSelection = cssVariable(themeColorsCss, "--color-lavender-100");
    const newSelection = cssVariable(themeColorsCss, "--color-lavender-200");
    expect(contrast(newSelection, sidebar)).toBeGreaterThan(
      contrast(oldSelection, sidebar),
    );
  });

  it("keeps the secondary button border visible on its new fill", () => {
    const lightBorder = cssVariable(themeLightCss, "--border-strong");
    const darkBorder = cssVariable(themeDarkCss, "--border-strong");
    const lightFill = cssVariable(themeColorsCss, "--color-surface-3");
    expect(contrast(lightBorder, lightFill)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkBorder, cssVariable(themeDarkCss, "--surface-subtle")))
      .toBeGreaterThanOrEqual(3);
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
