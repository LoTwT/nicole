import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as preview from "../editor/rendering/preview";
import { captureExportReadingStyle, prepareDocumentExport } from "./document-export";

// Vitest disables CSS transforms by default, including raw CSS imports.
// Read the installed/project styles here so font embedding exercises real CSS.
// @ts-expect-error Node-backed fixtures follow the project's browser-only TS config.
vi.mock("katex/dist/katex.css?raw", async () => ({ default: await (await import("node:fs/promises")).readFile("node_modules/katex/dist/katex.css", "utf8") }));
// @ts-expect-error Node-backed fixtures follow the project's browser-only TS config.
vi.mock("../editor/rendering/rendering.css?raw", async () => ({ default: await (await import("node:fs/promises")).readFile("src/editor/rendering/rendering.css", "utf8") }));

vi.mock("mermaid", () => ({ default: {
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 30"><text x="1" y="20">中文图表</text></svg>' })),
} }));

const fetchResource = vi.fn<typeof fetch>();
beforeEach(() => { vi.stubGlobal("fetch", fetchResource); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fetchResource.mockReset();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("style");
});

function parsed(html: string): Document { return new DOMParser().parseFromString(html, "text/html"); }

describe("standalone document export", () => {
  it("exports sanitized semantic HTML, resolved reading preferences and plain text without changing source", async () => {
    const source = "# 中文标题\n\n**加粗**与[链接](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> [!NOTE]\n> 提示\n\n<script>alert(1)</script>";
    const result = await prepareDocumentExport({ source, title: "标题</title><script>x</script>", style: {
      theme: "dark", fontSize: 22, lineHeight: 2, contentWidth: 72,
      variables: { "--text-primary": "#eee", "--surface-canvas": "#222", "--unrelated": "red" },
      css: ".nicole-reading-preview { color: purple; }",
    } });
    const dom = parsed(result.html);
    expect(dom.documentElement.classList.contains("dark")).toBe(true);
    expect(dom.title).toBe("标题</title><script>x</script>");
    expect(dom.querySelector("h1")?.textContent).toBe("中文标题");
    expect(dom.querySelector("strong")?.textContent).toBe("加粗");
    expect(dom.querySelectorAll("td")).toHaveLength(2);
    expect(dom.querySelector("script")).toBeNull();
    expect(dom.querySelector("style")?.textContent).toContain("--reading-font-size:22px");
    expect(dom.querySelector("style")?.textContent).toContain("[data-nicole-reading] .nicole-reading-preview { color: purple }");
    expect(dom.querySelector("[data-nicole-reading] .nicole-reading-preview")).not.toBeNull();
    expect(dom.querySelector("style")?.textContent).not.toContain("--unrelated");
    expect(dom.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("script-src 'none'");
    expect(result.plainText).toContain("A\tB\n1\t2");
    expect(result.plainText).toContain("加粗与链接");
    expect(result.warnings).toEqual([]);
    expect(fetchResource).not.toHaveBeenCalled();
    expect(source).toContain("**加粗**");
  });

  it("embeds generation-authorized local images, reuses duplicates and does not request remote images", async () => {
    fetchResource.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const result = await prepareDocumentExport({
      source: "![本地](a.png) ![重复](a.png) ![远程](https://example.com/tracker.png)", title: "图片",
      resolveImage: (source) => source === "a.png" ? "nicole-image://localhost/7/assets/a.png" : source,
      style: {},
    });
    const images = [...parsed(result.html).querySelectorAll("img")];
    expect(images).toHaveLength(2);
    expect(images.every((image) => image.getAttribute("src") === "data:image/png;base64,AQID")).toBe(true);
    expect(images.every((image) => !image.hasAttribute("loading"))).toBe(true);
    expect(fetchResource).toHaveBeenCalledTimes(1);
    expect(fetchResource.mock.calls[0]?.[0]).toBe("nicole-image://localhost/7/assets/a.png");
    expect(result.plainText).toContain("远程");
    expect(result.warnings).toEqual(["远程图片未嵌入，已保留替代文本"]);
  });

  it("includes folded callout bodies in print and rich clipboard output", async () => {
    const options = { source: "> [!NOTE]- 备注\n> 必须包含的内容", title: "折叠备注", style: {} };
    const html = await prepareDocumentExport(options);
    expect(parsed(html.html).querySelector("details")?.open).toBe(false);
    const printed = await prepareDocumentExport({ ...options, expandCallouts: true });
    expect(parsed(printed.html).querySelector("details")?.open).toBe(true);
    expect(printed.plainText).toContain("必须包含的内容");
  });

  it("embeds local formula fonts and keeps math plus diagrams in the standalone HTML", async () => {
    fetchResource.mockImplementation(async () => new Response(new Uint8Array([119, 79, 70, 50])));
    const result = await prepareDocumentExport({
      source: "中文 $x^2$\n\n```mermaid\ngraph TD\nA-->B\n```", title: "公式与图表", style: {},
    });
    const dom = parsed(result.html);
    expect(dom.querySelector(".katex math")).not.toBeNull();
    expect(dom.querySelector(".nicole-mermaid svg text")?.textContent).toBe("中文图表");
    expect(dom.querySelector("style")?.textContent).toContain('src:url("data:font/woff2;base64,');
    expect(dom.querySelector("style")?.textContent).not.toMatch(/url\((?!["']?data:)/i);
    expect(fetchResource.mock.calls.length).toBeGreaterThan(0);
    expect(fetchResource.mock.calls.every(([url]) => String(url).includes("KaTeX_") && String(url).endsWith(".woff2"))).toBe(true);
    expect(result.plainText).toContain("中文 x^2");
    expect(result.plainText.match(/x\^2/g)).toHaveLength(1);
  });

  it("rejects failed local resources rather than returning a broken export", async () => {
    fetchResource.mockResolvedValue(new Response(null, { status: 404 }));
    await expect(prepareDocumentExport({ source: "![本地](a.png)", title: "失效", resolveImage: () => "nicole-image://localhost/7/a.png", style: {} }))
      .rejects.toThrow("本地图片无法嵌入，导出未保存");
  });

  it("rejects a changed async source and an explicitly canceled operation", async () => {
    let current = true;
    fetchResource.mockImplementation(async () => {
      current = false;
      return new Response(new Uint8Array([1]));
    });
    await expect(prepareDocumentExport({ source: "![](a.png)", title: "过期", resolveImage: () => "nicole-image://localhost/7/a.png", isCurrent: () => current, style: {} }))
      .rejects.toMatchObject({ name: "AbortError" });
    const controller = new AbortController();
    controller.abort();
    await expect(prepareDocumentExport({ source: "正文", title: "取消", signal: controller.signal, style: {} }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds a renderer that never settles with an explicit timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(preview, "renderMarkdownPreview").mockReturnValue(new Promise(() => {}));
    const result = prepareDocumentExport({ source: "正文", title: "超时", style: {} });
    const assertion = expect(result).rejects.toMatchObject({ name: "TimeoutError", message: "导出准备超过 30 秒，请重试" });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
  });

  it("captures the current resolved theme and rejects resource-bearing custom CSS", async () => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.setProperty("--reading-font-body", '"Songti SC", serif');
    document.documentElement.style.setProperty("--text-primary", "rgb(230, 230, 230)");
    const style = captureExportReadingStyle();
    expect(style.theme).toBe("dark");
    expect(style.fontFamily).toBe('"Songti SC", serif');
    expect(style.variables?.["--text-primary"]).toBe("rgb(230, 230, 230)");
    await expect(prepareDocumentExport({ source: "正文", title: "CSS", style: { css: 'p{background:url(https://example.com)}' } }))
      .rejects.toThrow("不支持外部资源");
    expect(fetchResource).not.toHaveBeenCalled();
  });
});
