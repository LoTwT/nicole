import { ref } from "vue";
import { countWords } from "./word-count";

export interface WritingPreferences {
  focusMode: boolean;
  typewriterMode: boolean;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  keybindings: Record<string, string>;
  customCss: string;
}

export function defaultWritingPreferences(): WritingPreferences {
  return {
    focusMode: false,
    typewriterMode: false,
    fontSize: 18,
    lineHeight: 1.7,
    contentWidth: 65,
    keybindings: {},
    customCss: "",
  };
}

export function normalizeWritingPreferences(
  value?: Partial<WritingPreferences> | null,
): WritingPreferences {
  const defaults = defaultWritingPreferences();
  const number = (
    key: "fontSize" | "lineHeight" | "contentWidth",
    min: number,
    max: number,
  ) =>
    typeof value?.[key] === "number" &&
    Number.isFinite(value[key]) &&
    value[key] !== 0
      ? Math.min(max, Math.max(min, value[key]))
      : defaults[key];
  return {
    focusMode: value?.focusMode === true,
    typewriterMode: value?.typewriterMode === true,
    fontSize: number("fontSize", 12, 36),
    lineHeight: number("lineHeight", 1.2, 2.4),
    contentWidth: number("contentWidth", 40, 100),
    keybindings:
      value?.keybindings &&
      typeof value.keybindings === "object" &&
      !Array.isArray(value.keybindings)
        ? Object.fromEntries(
            Object.entries(value.keybindings).filter(
              ([id, key]) =>
                /^[a-z][a-z0-9.-]{0,79}$/.test(id) &&
                typeof key === "string" &&
                key.length <= 80,
            ),
          )
        : {},
    customCss: typeof value?.customCss === "string" ? value.customCss : "",
  };
}

const allowedProperties =
  /^(?:color|background-color|font(?:-family|-size|-weight|-style|-variant)?|line-height|letter-spacing|word-spacing|text-(?:align|decoration|indent|transform|shadow)|border(?:-(?:top|right|bottom|left))?(?:-color|-width|-style|-radius)?|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|--[a-z][a-z0-9-]*)$/i;

/** A deliberately small reading-only CSS subset: no resource loading or UI escape. */
export function compileReadingCSS(source: string): {
  css: string;
  error: string | null;
} {
  if (new TextEncoder().encode(source).length > 20000)
    return { css: "", error: "自定义 CSS 不能超过 20 KB" };
  if (/@|url\s*\(|expression\s*\(|javascript:|\\|<|>/i.test(source))
    return { css: "", error: "不支持外部资源、at-rule、转义或复杂选择器" };
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (/@|url\s*\(|expression\s*\(|javascript:|\\|<|>/i.test(clean))
    return { css: "", error: "不支持外部资源或可执行 CSS" };
  if (!clean) return { css: "", error: null };
  let rest = clean;
  const rules: string[] = [];
  while (rest.trim()) {
    const match = /^\s*([^{}]+)\{([^{}]*)\}/.exec(rest);
    if (!match) return { css: "", error: "请输入完整的 CSS 规则，不支持嵌套" };
    const selectors = match[1]!.split(",").map((value) => value.trim());
    if (
      selectors.some(
        (value) =>
          !/^[a-zA-Z.#][a-zA-Z0-9_.#\s:-]*$/.test(value) ||
          /:(?:root|scope|host)/i.test(value),
      )
    ) {
      return { css: "", error: "选择器只支持标签、类名、ID 和简单后代" };
    }
    const declarations = match[2]!
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean);
    for (const declaration of declarations) {
      const property = /^([a-zA-Z-]+)\s*:\s*(.+)$/.exec(declaration);
      if (
        !property ||
        !allowedProperties.test(property[1]!) ||
        /[{}]/.test(property[2]!)
      ) {
        return { css: "", error: "仅支持文字、颜色、边框和间距属性" };
      }
    }
    rules.push(
      `${selectors.map((selector) => `[data-nicole-reading] ${selector}`).join(",")} { ${declarations.join(";")} }`,
    );
    rest = rest.slice(match[0].length);
  }
  return { css: rules.join("\n"), error: null };
}

/** Mixed text estimate: CJK250 characters/minute, other words200/minute. */
export function writingStatistics(text: string, selection = "") {
  const words = countWords(text);
  let cjk = 0;
  for (const char of text)
    if (
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
        char,
      )
    )
      cjk++;
  return {
    words,
    selectedWords: countWords(selection),
    hasSelection: selection.length > 0,
    minutes:
      words === 0 ? 0 : Math.max(1, Math.ceil(cjk / 250 + (words - cjk) / 200)),
  };
}

/** Field intents are held until a real stored baseline is known. */
export function useWritingPreferences(options: {
  load: () => Promise<Partial<WritingPreferences> | undefined>;
  save: (value: WritingPreferences) => Promise<unknown>;
  onError: (error: unknown) => void;
  canRetry?: () => boolean;
}) {
  const value = ref(defaultWritingPreferences());
  let baseline: WritingPreferences | null = null;
  const chosen = new Set<keyof WritingPreferences>();
  let revision = 0;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reading: Promise<void> | null = null;
  let queue = Promise.resolve();
  function hydrate(loaded?: Partial<WritingPreferences>) {
    const saved = normalizeWritingPreferences(loaded);
    if (baseline !== null) return;
    baseline = saved;
    value.value = {
      ...saved,
      ...Object.fromEntries([...chosen].map((key) => [key, value.value[key]])),
    };
    if (pending) flush();
  }
  function retry() {
    if (baseline !== null || reading !== null || options.canRetry?.() === false)
      return reading;
    reading = options
      .load()
      .then(hydrate)
      .catch(options.onError)
      .finally(() => {
        reading = null;
      });
    return reading;
  }
  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return queue;
    if (baseline === null) {
      void retry();
      return queue;
    }
    pending = false;
    const currentRevision = revision;
    const snapshot = normalizeWritingPreferences(value.value);
    queue = queue.then(async () => {
      try {
        await options.save(snapshot);
        baseline = snapshot;
      } catch (error) {
        if (currentRevision === revision && baseline !== null)
          value.value = baseline;
        options.onError(error);
      }
    });
    return queue;
  }
  function update(patch: Partial<WritingPreferences>) {
    for (const key of Object.keys(patch) as (keyof WritingPreferences)[])
      chosen.add(key);
    value.value = normalizeWritingPreferences({ ...value.value, ...patch });
    revision++;
    pending = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, 350);
  }
  return { value, hydrate, update, flush, retry };
}
