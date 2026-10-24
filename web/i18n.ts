import {
  getLocale,
  localizeMessage,
  setCoreLocale,
  tr,
  type Locale,
} from "../core/i18n";

export { getLocale, localizeMessage, tr };
export type { Locale };

const listeners = new Set<(locale: Locale) => void>();

function initialLocale(): Locale {
  try {
    return localStorage.getItem("locale") === "zh-CN" ? "zh-CN" : "en";
  } catch {
    return "en";
  }
}

setCoreLocale(initialLocale());
if (typeof document !== "undefined")
  document.documentElement.lang = getLocale();

export function onLocaleChange(listener: (locale: Locale) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setLocale(locale: Locale) {
  setCoreLocale(locale);
  try {
    localStorage.setItem("locale", getLocale());
  } catch {}
  if (typeof document !== "undefined")
    document.documentElement.lang = getLocale();
  for (const listener of listeners) listener(getLocale());
}

/** Register existing static labels once; dynamic source and user values are left alone. */
export function bindStaticLocale(
  root: Element,
  catalog: Record<string, string>,
  excludeSelector = "",
) {
  const bindings: Array<(locale: Locale) => void> = [];
  const excluded = (element: Element, text: boolean) =>
    !!element.closest(
      [
        text ? "script,style,textarea,pre,code" : "script,style,pre,code",
        excludeSelector,
      ]
        .filter(Boolean)
        .join(","),
    );
  const label = (value: string) => {
    const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(value)!;
    const english = catalog[match[2]];
    return english === undefined
      ? undefined
      : {
          chinese: value,
          english: match[1] + english + match[3],
        };
  };
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || excluded(parent, true)) continue;
    const translated = label(node.nodeValue || "");
    if (!translated) continue;
    // An option without a value attribute derives its value from its label.
    // Pin the existing value before translating the visible label.
    if (parent.tagName === "OPTION" && !parent.hasAttribute("value"))
      parent.setAttribute("value", (parent as HTMLOptionElement).value);
    const target = node;
    bindings.push((locale) => {
      target.nodeValue =
        locale === "en" ? translated.english : translated.chinese;
    });
  }
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (excluded(element, false)) continue;
    for (const attribute of ["title", "placeholder", "aria-label"]) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const translated = label(value);
      if (translated)
        bindings.push((locale) => {
          element.setAttribute(
            attribute,
            locale === "en" ? translated.english : translated.chinese,
          );
        });
    }
  }
  const update = (locale: Locale) => {
    for (const binding of bindings) binding(locale);
  };
  update(getLocale());
  return onLocaleChange(update);
}
