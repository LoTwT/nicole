import { createApp, h, nextTick } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

import LinkImageEditor from "./LinkImageEditor.vue";
import type { LinkImageEditorSession, PopoverAnchor } from "../editor/link-editor";

let app: ReturnType<typeof createApp> | null = null;

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

function session(
  overrides: Partial<LinkImageEditorSession> = {},
): LinkImageEditorSession {
  return {
    kind: "link",
    isNew: false,
    initialText: "文字",
    initialUrl: "url",
    preserveEditorFocus: true,
    canRemove: true,
    valid: true,
    anchor: () => ({ left: 100, right: 160, top: 100, bottom: 120 }),
    update: () => {},
    complete: () => true,
    remove: () => true,
    subscribe: () => () => {},
    dispose: () => {},
    ...overrides,
  };
}

function mount(
  editSession: LinkImageEditorSession,
  options: {
    initialText?: string;
    initialUrl?: string;
    isRevealablePath?: (path: string) => boolean;
    onComplete?: (text: string, url: string) => void;
    onCancel?: () => void;
    onRemove?: () => void;
    onReveal?: (path: string) => void;
  } = {},
) {
  const host = document.createElement("div");
  document.body.append(host);
  app = createApp({
    render: () =>
      h(LinkImageEditor, {
        session: editSession,
        initialText: options.initialText ?? editSession.initialText,
        initialUrl: options.initialUrl ?? editSession.initialUrl,
        platform: "macos",
        isRevealablePath: options.isRevealablePath ?? (() => false),
        onComplete: options.onComplete,
        onCancel: options.onCancel,
        onRemove: options.onRemove,
        onReveal: options.onReveal,
      }),
  });
  app.mount(host);
  return host;
}

function dialog(): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    "[data-link-image-editor]",
  );
  if (!element) throw new Error("link image dialog not found");
  return element;
}

function input(label: string): HTMLInputElement {
  const element = dialog().querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  if (!element) throw new Error(`input ${label} not found`);
  return element;
}

describe("LinkImageEditor", () => {
  it("positions a 340px dialog below or above its target and follows scroll", async () => {
    let anchor: PopoverAnchor = { left: 100, right: 160, top: 100, bottom: 120 };
    const listeners = new Set<() => void>();
    mount(
      session({
        subscribe(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        anchor: () => anchor,
      }),
    );
    await nextTick();
    expect(dialog().className).toContain("w-[340px]");
    expect(dialog().dataset.placement).toBe("below");

    anchor = { left: 500, right: 560, top: 760, bottom: 780 };
    for (const listener of listeners) listener();
    await nextTick();
    expect(dialog().dataset.placement).toBe("above");

    anchor = { left: 20, right: 80, top: 100, bottom: 120 };
    document.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(dialog().style.left).toBe("20px");
  });

  it("focuses the first field unless a click kept body focus", async () => {
    mount(session({ preserveEditorFocus: false }));
    await nextTick();
    expect(document.activeElement).toBe(input("文本"));
    app?.unmount();
    app = null;

    mount(session({ preserveEditorFocus: true }));
    await nextTick();
    expect(document.activeElement).not.toBe(input("文本"));
  });

  it("completes with Enter and cancels with Escape", async () => {
    const complete = vi.fn();
    const cancel = vi.fn();
    mount(session({ preserveEditorFocus: false }), {
      onComplete: complete,
      onCancel: cancel,
    });
    await nextTick();
    input("文本").value = "新文字";
    input("文本").dispatchEvent(new Event("input", { bubbles: true }));
    input("链接").value = "new-url";
    input("链接").dispatchEvent(new Event("input", { bubbles: true }));

    input("文本").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(complete).toHaveBeenCalledWith("新文字", "new-url");

    input("文本").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not commit or cancel keys owned by an IME composition", async () => {
    const complete = vi.fn();
    const cancel = vi.fn();
    mount(session({ preserveEditorFocus: false }), {
      onComplete: complete,
      onCancel: cancel,
    });
    await nextTick();
    input("文本").dispatchEvent(new Event("compositionstart"));
    input("文本").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    input("文本").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(complete).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();

    input("文本").dispatchEvent(new Event("compositionend"));
    input("文本").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(complete).toHaveBeenCalledOnce();
  });

  it("offers link removal only for an existing link", async () => {
    const remove = vi.fn();
    mount(session(), { onRemove: remove });
    const button = [...dialog().querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "移除链接",
    )!;
    button.click();
    expect(remove).toHaveBeenCalledOnce();
    app?.unmount();
    app = null;

    mount(session({ kind: "image", canRemove: false }));
    expect(
      [...dialog().querySelectorAll("button")].some(
        (item) => item.textContent?.trim() === "移除链接",
      ),
    ).toBe(false);
  });

  it("disables image reveal for remote paths and enables it for local ones", async () => {
    const reveal = vi.fn();
    const check = vi.fn((path: string) => path === "assets/a.png");
    mount(
      session({
        kind: "image",
        canRemove: false,
        initialText: "图",
        initialUrl: "assets/a.png",
      }),
      {
        initialText: "图",
        initialUrl: "assets/a.png",
        isRevealablePath: check,
        onReveal: reveal,
      },
    );
    await nextTick();
    const button = [...dialog().querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "在 Finder 中显示",
    )!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(reveal).toHaveBeenCalledWith("assets/a.png");

    input("路径").value = "https://example.com/a.png";
    input("路径").dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(button.disabled).toBe(true);
    button.click();
    expect(reveal).toHaveBeenCalledOnce();
  });
});
