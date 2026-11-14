import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

import type { AppPlatform } from "../app/platform";
import type { CommandDefinition, CommandKeyBinding } from "../commands/types";
import { canonicalShortcut, commandBindings } from "../commands/keybinding-settings";
import { resolveKeyBinding } from "../commands/registry";

/**
 * Builds the editor keymap from the shared registry. `Prec.highest` is
 * intentional: commands such as Mod-i must beat basicSetup and any competing
 * `Prec.high` binding.
 */
export function createCommandKeymap(
  commands: readonly CommandDefinition[],
  platform: AppPlatform,
) {
  const bindings = commands
    .filter((command) => command.scope === "editor")
    .flatMap((command) =>
      commandBindings(command).map((binding) => ({
        ...binding,
        run: (view: EditorView) => {
          // The IME owns every key while a composition is active. Returning
          // false leaves Enter, arrows and Escape to the candidate window.
          if (view.compositionStarted || view.composing) return false;
          if (view.state.readOnly) return true;
          return command.run({ view, platform });
        },
      })),
    );
  const signature = (binding: CommandKeyBinding) => {
    const key = resolveKeyBinding(binding, platform);
    return key === null ? null : canonicalShortcut(key, platform) ?? key.toLowerCase();
  };
  const active = new Set(commands
    .filter((command) => command.scope === "editor" || command.scope === "app")
    .flatMap((command) => commandBindings(command).map(signature)));
  // File-tree keys such as Enter and Delete never suppress document editing.
  // Only an editor command's freed key needs to shadow basicSetup defaults.
  const removed = commands
    .filter((command) => command.scope === "editor")
    .flatMap((command) => (command.keys ?? [])
      .filter((binding) => {
        const key = signature(binding);
        return key !== null && !active.has(key);
      })
      .map((binding) => ({
        ...binding,
        run: (view: EditorView) => !view.compositionStarted && !view.composing,
      })));
  return Prec.highest(keymap.of([...bindings, ...removed]));
}
