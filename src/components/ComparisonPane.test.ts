import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ComparisonPane, { type ComparisonDocument } from "./ComparisonPane.vue";

const render = vi.hoisted(() => vi.fn());
vi.mock("../editor/rendering/preview", () => ({ renderMarkdownPreview: render }));

let app: ReturnType<typeof createApp> | null = null;
let host: HTMLElement;
const documents: ComparisonDocument[] = [
  { id: 1, name: "one.md", text: "# One", sourceKey: "one:1" },
  { id: 2, name: "two.md", text: "# Two", sourceKey: "two:1" },
];

async function settle() {
  for (let n = 0; n < 4; n++) await nextTick();
  await vi.advanceTimersByTimeAsync(160);
  for (let n = 0; n < 4; n++) await nextTick();
}

function mount() {
  const selectedId = ref(1);
  const available = ref(documents);
  const events = { close: vi.fn(), open: vi.fn() };
  app = createApp(defineComponent({
    setup: () => () => h(ComparisonPane, {
      documents: available.value,
      selectedId: selectedId.value,
      resolveImage: (source: string) => `nicole-image://localhost/1/${source}`,
      onSelect: (id: number) => { selectedId.value = id; },
      onClose: events.close,
      onOpenLink: events.open,
    }),
  }));
  app.mount(host);
  return { selectedId, events, available };
}

beforeEach(() => {
  vi.useFakeTimers();
  render.mockReset();
  document.body.innerHTML = '<div id="test-root"></div>';
  host = document.querySelector<HTMLElement>("#test-root")!;
});

afterEach(() => {
  app?.unmount();
  app = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("read-only document comparison", () => {
  it("routes links without native WebView navigation or editable content", async () => {
    render.mockResolvedValue('<h1>One</h1><a href="https://example.com">外链</a>');
    const { events } = mount();
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("One");
    expect(host.querySelector('[contenteditable="true"]')).toBeNull();
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("a")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(events.open).toHaveBeenCalledWith("https://example.com", 1);
    host.querySelector<HTMLButtonElement>('button[aria-label="关闭文档对照"]')!.click();
    expect(events.close).toHaveBeenCalledOnce();
  });

  it("aborts stale rendering when a different comparison document is chosen", async () => {
    let resolveOld!: (html: string) => void;
    render.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve; }));
    render.mockResolvedValueOnce("<h1>Two</h1>");
    const { selectedId } = mount();
    await settle();
    const signal = render.mock.calls[0]![1].signal as AbortSignal;
    selectedId.value = 2;
    await settle();
    expect(signal.aborted).toBe(true);
    expect(host.querySelector("h1")?.textContent).toBe("Two");
    resolveOld("<h1>Old document</h1>");
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Two");
  });

  it("keeps the last preview visible during same-document typing but does not navigate stale links", async () => {
    render.mockResolvedValueOnce('<h1>One</h1><a href="old.md">旧链接</a>');
    let finish!: (html: string) => void;
    render.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const { available, events, selectedId } = mount();
    await settle();
    available.value = documents.map((doc) => doc.id === 1 ? { ...doc, text: "# Updated" } : doc);
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("One");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    host.querySelector("a")!.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(events.open).not.toHaveBeenCalled();
    finish("<h1>Updated</h1>");
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Updated");
    selectedId.value = 2;
    await nextTick();
    expect(host.querySelector("h1")).toBeNull();
  });

  it("keeps source readable after a rendering failure and cancels work on close", async () => {
    render.mockRejectedValueOnce(new Error("invalid markup"));
    mount();
    await settle();
    expect(host.querySelector("pre")?.textContent).toBe("# One");
    const signal = render.mock.calls[0]![1].signal as AbortSignal;
    app!.unmount();
    app = null;
    expect(signal.aborted).toBe(true);
  });
});
