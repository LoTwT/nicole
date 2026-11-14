import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderInlineMarkdownPreview, renderMarkdownPreview } from "./preview";
import { sanitizeSvg } from "./sanitize";

const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>',
  })),
}));
vi.mock("mermaid", () => ({ default: mermaid }));

function fragment(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

beforeEach(() => {
  mermaid.render.mockImplementation(async () => ({
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>diagram</text></svg>',
  }));
});

describe("safe Markdown preview", () => {
  it("renders ordinary Markdown and GFM without executing document HTML", async () => {
    const html = await renderMarkdownPreview(
      "# Title\n\n| A | B |\n| --- | --- |\n| x | y |\n\n- [x] done\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
    );
    const dom = fragment(html);
    expect(dom.querySelector("h1")?.textContent).toBe("Title");
    expect(dom.querySelectorAll("td")).toHaveLength(2);
    expect(dom.querySelector("input")?.disabled).toBe(true);
    expect(dom.querySelector("input")?.checked).toBe(true);
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.textContent).toContain("<script>alert(1)</script>");
    expect(dom.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it("resolves image paths without leaking the app protocol into Markdown", async () => {
    const source = "![alt](../assets/photo.png)";
    const resolveImage = vi.fn(() => "nicole-image://localhost/1/assets/photo.png");
    const dom = fragment(await renderMarkdownPreview(source, { resolveImage }));
    expect(resolveImage).toHaveBeenCalledWith("../assets/photo.png");
    expect(dom.querySelector("img")?.getAttribute("src"))
      .toBe("nicole-image://localhost/1/assets/photo.png");
    expect(dom.querySelector("img")?.alt).toBe("alt");
    expect(source).toBe("![alt](../assets/photo.png)");
    const denied = fragment(await renderMarkdownPreview(source, { resolveImage: () => null }));
    expect(denied.querySelector("img")).toBeNull();
    expect(denied.textContent?.trim()).toBe("alt");
  });

  it("renders inline and block math and preserves invalid formula text", async () => {
    const inline = await renderInlineMarkdownPreview("**value** $x^2$");
    const dom = fragment(inline);
    expect(dom.querySelector("strong")?.textContent).toBe("value");
    expect(dom.querySelector(".katex")).not.toBeNull();
    expect(dom.querySelector("p")).toBeNull();
    const block = fragment(await renderMarkdownPreview("$$\nx^2 + y^2\n$$"));
    expect(block.querySelector(".katex-display")).not.toBeNull();
    const invalid = fragment(await renderInlineMarkdownPreview("$\\badcommand{x}$"));
    expect(invalid.querySelector(".nicole-render-error")?.textContent).toBe("\\badcommand{x}");
    const hostile = fragment(await renderInlineMarkdownPreview("$\\href{javascript:alert(1)}{x}$"));
    expect(hostile.querySelector("a")).toBeNull();
  });

  it("keeps escaped dollars, prices, code and incomplete formulas as text", async () => {
    const dom = fragment(await renderMarkdownPreview(
      "\\$notmath$ costs $5 and $10.\n\n" +
      String.fromCharCode(96) + "$x$" + String.fromCharCode(96) +
      "\n\n$$\nunclosed",
    ));
    expect(dom.querySelector(".katex")).toBeNull();
    expect(dom.querySelector("code")?.textContent).toBe("$x$");
    expect(dom.textContent).toContain("unclosed");
  });

  it("renders a callout's kind and Markdown title without treating arbitrary quotes as callouts", async () => {
    const dom = fragment(await renderMarkdownPreview(
      "> [!WARNING] **Careful**\n> Keep your files.\n\n> ordinary",
    ));
    expect(dom.querySelector(".nicole-callout-warning")).not.toBeNull();
    expect(dom.querySelector(".nicole-callout-title strong")?.textContent).toBe("Careful");
    expect(dom.querySelector(".nicole-callout-title")?.textContent).not.toContain("Keep your files.");
    expect(dom.querySelectorAll(".nicole-callout")).toHaveLength(1);
    expect(dom.querySelectorAll("blockquote")).toHaveLength(2);
  });

  it("uses native disclosure semantics for signed callouts, including nested ones", async () => {
    const dom = fragment(await renderMarkdownPreview(
      "> [!NOTE]- **Closed**\n> Body\n>\n> > [!TIP]+ Open\n> > Nested body\n\n> [!INFO] Plain\n> Always visible",
    ));
    const closed = dom.querySelector<HTMLDetailsElement>("details.nicole-callout-note")!;
    const opened = dom.querySelector<HTMLDetailsElement>("details.nicole-callout-tip")!;
    expect(closed.open).toBe(false);
    expect(closed.querySelector("summary strong")?.textContent).toBe("Closed");
    expect(opened.open).toBe(true);
    expect(opened.querySelector("summary")?.textContent).toBe("Open");
    expect(dom.querySelector("blockquote.nicole-callout-info")?.textContent).toContain("Always visible");
    expect(dom.querySelectorAll("summary")).toHaveLength(2);
  });

  it.each(["---", "..."])("skips closed Frontmatter ending with %s and maps real body source lines", async (closing) => {
    const fence = String.fromCharCode(96).repeat(3);
    const source = "---\ntitle: $metadata$\n" + closing + "\n\n# Heading\n\n$$x^2$$\n\n" +
      fence + "text\ncode\n" + fence;
    const dom = fragment(await renderMarkdownPreview(source, { sourceLines: true }));
    expect(dom.querySelector("hr")).toBeNull();
    expect(dom.textContent).not.toContain("metadata");
    expect(dom.querySelector("h1")?.getAttribute("data-source-line")).toBe("5");
    expect(dom.querySelector(".nicole-math-block")?.getAttribute("data-source-line")).toBe("7");
    expect(dom.querySelector("pre")?.getAttribute("data-source-line")).toBe("9");
    expect(fragment(await renderMarkdownPreview(source)).querySelector("[data-source-line]")).toBeNull();
  });

  it("keeps unfinished Frontmatter literal without interpreting YAML or document HTML", async () => {
    const source = "---\ntitle: <img src=x onerror=alert(1)>\n\n# Still metadata";
    const dom = fragment(await renderMarkdownPreview(source, { sourceLines: true }));
    expect(dom.querySelector("pre")?.textContent).toBe(source);
    expect(dom.querySelector("pre")?.getAttribute("data-source-line")).toBe("1");
    expect(dom.querySelector("img,h1,hr")).toBeNull();
  });

  it("lazy-renders code languages and keeps unknown-language text readable", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    const dom = fragment(await renderMarkdownPreview(
      fence + "typescript\nconst answer: number = 42;\n" + fence,
    ));
    expect(dom.querySelector(".tok-keyword")?.textContent).toBe("const");
    const unknown = fragment(await renderMarkdownPreview(
      fence + "unknown-nicole-language\n<tag>\n" + fence,
    ));
    expect(unknown.querySelector("code")?.textContent).toBe("<tag>\n");
    expect(unknown.querySelector("tag")).toBeNull();
  });

  it("renders diagrams with fixed strict configuration and sanitizes generated SVG", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    mermaid.render.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script><image href="https://bad.test/a"/><foreignObject><iframe src="https://bad.test"></iframe></foreignObject><text onclick="alert(1)">safe</text></svg>',
    });
    const dom = fragment(await renderMarkdownPreview(fence + "mermaid\nflowchart LR\nA-->B\n" + fence, { sourceLines: true }));
    expect(dom.querySelector(".nicole-mermaid")?.getAttribute("data-source-line")).toBe("1");
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: "strict",
      startOnLoad: false,
    }));
    expect(dom.querySelector("svg text")?.textContent).toBe("safe");
    expect(dom.querySelector("script,image,foreignObject,iframe,[onclick]")).toBeNull();
    const before = mermaid.render.mock.calls.length;
    const configured = fragment(await renderMarkdownPreview(fence + "mermaid\n%%{init: {securityLevel: 'loose'}}%%\nA-->B\n" + fence));
    expect(mermaid.render.mock.calls.length).toBe(before);
    expect(configured.textContent).toContain("不支持的配置");
    const image = fragment(await renderMarkdownPreview(
      fence + 'mermaid\nflowchart LR\nA@{ img: "https://bad.test/a" }\n' + fence,
    ));
    expect(mermaid.render.mock.calls.length).toBe(before);
    expect(image.textContent).toContain("不支持的配置");
    const escapedCss = fragment(await renderMarkdownPreview(
      fence + "mermaid\nflowchart LR; classDef evil fill:u\\72l(//bad.test/a); A:::evil-->B\n" + fence,
    ));
    expect(mermaid.render.mock.calls.length).toBe(before);
    expect(escapedCss.textContent).toContain("不支持的配置");
  });

  it("returns readable Mermaid errors and rejects stale async previews", async () => {
    const fence = String.fromCharCode(96).repeat(3);
    mermaid.render.mockRejectedValueOnce(new Error("parse failed"));
    const dom = fragment(await renderMarkdownPreview(fence + "mermaid\nnot a diagram\n" + fence));
    expect(dom.querySelector(".nicole-render-error")?.textContent).toContain("not a diagram");
    let complete!: (result: { svg: string }) => void;
    mermaid.render.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const controller = new AbortController();
    const pending = renderMarkdownPreview(fence + "mermaid\nflowchart LR\nA-->B\n" + fence, { signal: controller.signal });
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
    controller.abort();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    complete({ svg: "<svg><text>stale</text></svg>" });
    await rejected;
  });

  it("removes external SVG resource references while keeping internal markers", () => {
    const dom = fragment(sanitizeSvg(
      '<svg><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)" style="fill:u\\72l(//bad.test/a)"/><style>@im\\70ort "//bad.test/x";</style></svg>',
    ));
    expect(dom.querySelector("path")?.getAttribute("marker-end")).toBe("url(#arrow)");
    expect(dom.querySelector("path")?.hasAttribute("style")).toBe(false);
    expect(dom.querySelector("style")).toBeNull();
  });
});
