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

  function declaration(block: string, name: string): string {
    const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
    if (!match) {
      throw new Error(`missing ${name}`);
    }
    return match[1]!.trim();
  }

  function themeColor(block: string, name: string): string {
    const value = declaration(block, name);
    const token = value.match(/^var\((--color-[a-z0-9-]+)\)$/);
    if (!token) {
      throw new Error(`${name} must reference a theme color, got ${value}`);
    }
    return cssVariable(themeColorsCss, token[1]!);
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

  it("maps the light primary button to the theme accent pair", () => {
    const root = rule(":root");
    expect(declaration(root, "--nicole-primary-fill")).toBe(
      "var(--accent-primary)",
    );
    expect(declaration(root, "--nicole-primary-fill-hover")).toBe(
      "var(--accent-primary-hover)",
    );
    expect(declaration(root, "--nicole-primary-fill-active")).toBe(
      "var(--accent-primary-active)",
    );
    expect(declaration(root, "--nicole-primary-content")).toBe(
      "var(--accent-contrast)",
    );
    expect(declaration(root, "--nicole-primary-content-hover")).toBe(
      "var(--accent-contrast-hover)",
    );
    expect(declaration(root, "--nicole-primary-content-active")).toBe(
      "var(--accent-contrast-active)",
    );
  });

  it("keeps the dark primary button readable and never dimmer when pressed", () => {
    const dark = rule(".dark");
    const fill = themeColor(dark, "--nicole-primary-fill");
    const hoverFill = themeColor(dark, "--nicole-primary-fill-hover");
    const activeFill = themeColor(dark, "--nicole-primary-fill-active");
    const content = themeColor(dark, "--nicole-primary-content");
    const contentHover = themeColor(
      dark,
      "--nicole-primary-content-hover",
    );
    const contentActive = themeColor(
      dark,
      "--nicole-primary-content-active",
    );

    const canvas = cssVariable(themeDarkCss, "--surface-canvas");
    // The old dark fill was lavender-700 on the same canvas; this one is
    // clearly brighter, not just a different hue.
    const oldFill = cssVariable(themeColorsCss, "--color-lavender-700");
    expect(contrast(fill, canvas)).toBeGreaterThan(contrast(oldFill, canvas));
    expect(contrast(fill, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fill, content)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hoverFill, contentHover)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(activeFill, contentActive)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(hoverFill)).toBeGreaterThan(luminance(fill));
    expect(luminance(activeFill)).toBeGreaterThanOrEqual(luminance(fill));
  });

  it("keeps the on-accent focus ring on primary buttons in both themes", () => {
    const focus = rule(".button-primary:focus-visible");
    expect(focus).toMatch(
      /--focus-ring-color:\s*var\(--focus-ring-on-accent-color\);/,
    );
    expect(focus).toMatch(
      /--focus-ring-shadow:\s*var\(--focus-ring-on-accent-shadow\);/,
    );
    // The utility owns outline width and the contrast/forced-colors fallbacks.
    expect(focus).not.toMatch(/outline|box-shadow/);

    expect(declaration(themeLightCss, "--focus-ring-on-accent-color")).toBe(
      "var(--accent-contrast)",
    );
    expect(declaration(themeDarkCss, "--focus-ring-on-accent-color")).toBe(
      "var(--accent-contrast)",
    );
  });

  it("shares a stronger selected-row color across list surfaces", () => {
    const root = rule(":root");
    const dark = rule(".dark");
    expect(declaration(root, "--nicole-selected-row")).toBe(
      "var(--color-lavender-200)",
    );
    expect(declaration(dark, "--nicole-selected-row")).toBe(
      "var(--color-lavender-900)",
    );
    expect(css).not.toMatch(/--accent-soft\s*:/);

    const sidebar = cssVariable(themeColorsCss, "--color-surface-1");
    const oldSelection = cssVariable(themeColorsCss, "--color-lavender-100");
    const lightSelection = themeColor(root, "--nicole-selected-row");
    expect(contrast(lightSelection, sidebar)).toBeGreaterThan(
      contrast(oldSelection, sidebar),
    );

    const darkSelection = themeColor(dark, "--nicole-selected-row");
    const darkPanel = cssVariable(themeDarkCss, "--surface-panel");
    const darkHover = cssVariable(themeDarkCss, "--surface-subtle");
    const darkText = cssVariable(themeDarkCss, "--text-primary");
    expect(contrast(darkSelection, darkPanel)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(darkSelection, darkHover)).toBeGreaterThanOrEqual(1.2);
    expect(contrast(darkText, darkSelection)).toBeGreaterThanOrEqual(4.5);
  });

  it("strengthens only the Paper file tree hover", () => {
    const root = rule(":root");
    const dark = rule(".dark");
    expect(declaration(root, "--nicole-file-tree-hover")).toBe(
      "var(--surface-muted)",
    );
    expect(declaration(dark, "--nicole-file-tree-hover")).toBe(
      "var(--surface-subtle)",
    );

    const panel = cssVariable(themeColorsCss, "--color-surface-1");
    const oldHover = cssVariable(themeColorsCss, "--color-surface-3");
    const newHover = cssVariable(themeColorsCss, "--color-surface-4");
    expect(contrast(newHover, panel)).toBeGreaterThan(
      contrast(oldHover, panel),
    );

    const darkHover = cssVariable(themeDarkCss, "--surface-subtle");
    const darkPanel = cssVariable(themeDarkCss, "--surface-panel");
    expect(contrast(darkHover, darkPanel)).toBeGreaterThan(1.2);
  });

  it("defines one shared secondary button fill in both themes", () => {
    const base = rule(".button-secondary");
    expect(base).toMatch(/border-color:\s*var\(--border-default\);/);
    expect(base).toMatch(/background-color:\s*var\(--surface-subtle\);/);
    expect(base).toMatch(/color:\s*var\(--text-primary\);/);
    expect(rule(".button-secondary:hover:not(:disabled)")).toMatch(
      /background-color:\s*var\(--surface-muted\);/,
    );

    const lightFill = cssVariable(themeColorsCss, "--color-surface-3");
    const darkFill = cssVariable(themeDarkCss, "--surface-subtle");
    const lightCanvas = cssVariable(themeColorsCss, "--color-surface-0");
    const lightDialog = cssVariable(themeColorsCss, "--color-surface-2");
    const darkCanvas = cssVariable(themeDarkCss, "--surface-canvas");
    const darkDialog = cssVariable(themeDarkCss, "--surface-elevated");
    for (const [fill, background] of [
      [lightFill, lightCanvas],
      [lightFill, lightDialog],
      [darkFill, darkCanvas],
      [darkFill, darkDialog],
    ] as const) {
      expect(contrast(fill, background)).toBeGreaterThan(1);
    }
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
