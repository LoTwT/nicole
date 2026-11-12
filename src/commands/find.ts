import { findControllerForTarget } from "../editor/find";
import type { CommandDefinition } from "./types";

function openFind(
  context: Parameters<CommandDefinition["run"]>[0],
  replaceVisible: boolean,
): boolean {
  const controller = findControllerForTarget(context.view);
  if (controller === null) return false;
  controller.open(replaceVisible);
  return true;
}

function findDirection(
  context: Parameters<CommandDefinition["run"]>[0],
  direction: 1 | -1,
): boolean {
  const controller = findControllerForTarget(context.view);
  if (controller === null) return false;
  if (direction === 1) controller.next();
  else controller.previous();
  return true;
}

/**
 * Find commands live in the editor scope so the task checkbox can forward
 * Mod-f/Mod-g through the same keymap as ordinary editor focus.
 */
export const findCommands: readonly CommandDefinition[] = [
  {
    id: "edit.find",
    label: "查找",
    pinyin: "find search chazhao",
    group: "app",
    scope: "editor",
    keys: [{ key: "Mod-f" }],
    run: (context) => openFind(context, false),
  },
  {
    id: "edit.find-replace",
    label: "查找并替换",
    pinyin: "find replace search chazhaobingti",
    group: "app",
    scope: "editor",
    keys: [{ mac: "Mod-Alt-f", win: "Ctrl-h", linux: "Ctrl-h" }],
    run: (context) => openFind(context, true),
  },
  {
    id: "edit.find-next",
    label: "下一个匹配",
    pinyin: "find next search xiayigepipei",
    group: "app",
    scope: "editor",
    keys: [{ mac: "Mod-g", win: "F3", linux: "F3" }],
    run: (context) => findDirection(context, 1),
  },
  {
    id: "edit.find-previous",
    label: "上一个匹配",
    pinyin: "find previous search shangyigepipei",
    group: "app",
    scope: "editor",
    keys: [{ mac: "Shift-Mod-g", win: "Shift-F3", linux: "Shift-F3" }],
    run: (context) => findDirection(context, -1),
  },
];
