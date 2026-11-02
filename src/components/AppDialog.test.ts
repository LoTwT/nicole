import { createApp, defineComponent, h, nextTick, ref } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import AppDialog from "./AppDialog.vue";

let app: ReturnType<typeof createApp> | null = null;

async function settle() {
  for (let index = 0; index < 6; index++) {
    await nextTick();
  }
}

function mountDialog() {
  const host = document.createElement("div");
  document.body.append(host);
  const open = ref(false);
  const cancel = ref(0);
  const Component = defineComponent({
    setup() {
      return () =>
        h("div", [
          h("button", { id: "opener", onClick: () => (open.value = true) }, "open"),
          h(
            AppDialog,
            {
              open: open.value,
              title: "切换到“博客”",
              onCancel: () => {
                cancel.value++;
                open.value = false;
              },
            },
            {
              default: () => h("p", "当前标签页会关闭"),
              actions: () => [
                h("button", { "data-autofocus": "" }, "取消"),
                h("button", {}, "切换"),
              ],
            },
          ),
        ]);
    },
  });
  app = createApp(Component);
  app.mount(host);
  return { host, open, cancel };
}

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
});

describe("AppDialog", () => {
  it("uses dialog semantics and moves focus into the dialog", async () => {
    const { host, open } = mountDialog();
    await settle();
    const opener = host.querySelector<HTMLButtonElement>("#opener")!;
    opener.focus();
    open.value = true;
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement?.textContent).toBe("取消");
  });

  it("traps Tab and restores focus after Escape", async () => {
    const { host, open, cancel } = mountDialog();
    await settle();
    const opener = host.querySelector<HTMLButtonElement>("#opener")!;
    opener.focus();
    open.value = true;
    await settle();

    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
    const first = buttons[0]!;
    const last = buttons[1]!;
    last.focus();
    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }),
    );
    expect(document.activeElement).toBe(first);

    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(last);

    last.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
    await settle();
    expect(cancel.value).toBe(1);
    expect(document.activeElement).toBe(opener);
  });
});
