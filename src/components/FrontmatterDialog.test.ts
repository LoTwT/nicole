import { createApp, nextTick } from "vue";
import { afterEach, expect, it, vi } from "vitest";
import FrontmatterDialog from "./FrontmatterDialog.vue";
import { readFrontmatter } from "../app/frontmatter";

let app: ReturnType<typeof createApp> | null = null;
afterEach(() => { app?.unmount(); app = null; document.body.replaceChildren(); });

it("leaves Escape and Tab to an active composition even when the key event omits isComposing", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const cancel = vi.fn();
  app = createApp(FrontmatterDialog, { draft: readFrontmatter("---\ntitle: 原文\n---\n正文"), onCancel: cancel });
  app.mount(host);
  await nextTick();
  await nextTick();
  const field = document.querySelector<HTMLTextAreaElement>("textarea")!;
  field.focus();
  field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  await nextTick();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  field.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
  const tab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
  field.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  await nextTick();
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(cancel).toHaveBeenCalledOnce();
});
