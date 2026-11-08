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
  it("switches the accent fill and its content color together", () => {
    expect(styleCss).toMatch(
      /\.button-primary\s*\{[^}]*background-color:\s*var\(--accent-primary\);[^}]*color:\s*var\(--accent-contrast\);/s,
    );
    expect(styleCss).toMatch(
      /\.button-primary:hover:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--accent-primary-hover\);[^}]*color:\s*var\(--accent-contrast-hover\);/s,
    );
    expect(styleCss).toMatch(
      /\.button-primary:active:not\(:disabled\)\s*\{[^}]*background-color:\s*var\(--accent-primary-active\);[^}]*color:\s*var\(--accent-contrast-active\);/s,
    );
  });
});
