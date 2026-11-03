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

describe("floating layer contract", () => {
  it("keeps the overlay sidebar below the palette scrim and dialogs", () => {
    expect(styleCss).toMatch(
      /\.sidebar--overlay\s*\{[^}]*z-index:\s*var\(--z-header\)/s,
    );
    expect(zIndex("--z-header")).toBeLessThan(zIndex("--z-overlay"));
    expect(zIndex("--z-header")).toBeLessThan(zIndex("--z-modal"));
  });
});
