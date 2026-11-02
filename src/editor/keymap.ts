import { Prec } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";

import type { AppPlatform } from "../app/platform";
import type { CommandDefinition } from "../commands/types";

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
      (command.keys ?? []).map((binding) => ({
        ...binding,
        run: (view: EditorView) => {
          // The IME owns every key while a composition is active. Returning
          // false leaves Enter, arrows and Escape to the candidate window.
          if (view.compositionStarted || view.composing) return false;
          return command.run({ view, platform });
        },
      })),
    );
  return Prec.highest(keymap.of(bindings));
}
