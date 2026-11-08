export type SerialState<T> = {
  running: Promise<T> | undefined;
  queued: Promise<T> | undefined;
};

/**
 * Runs `f`, but never twice at the same time. If `f` is already running, it is
 * run again once the current run is done. That’s important for reloading CSS:
 * If a CSS file changes twice in quick succession, the first reload might have
 * fetched the file before the second change, and if the two reloads ran at the
 * same time, the first one might finish last, leaving the page with the old
 * CSS. Calls made while a run is already queued share that queued run, since
 * it hasn’t started yet and will pick up all changes.
 */
export async function runSerially<T>(
  state: SerialState<T>,
  f: () => Promise<T>,
): Promise<T> {
  if (state.queued !== undefined) {
    return state.queued;
  }

  if (state.running === undefined) {
    const running = f().finally(() => {
      state.running = undefined;
    });
    state.running = running;
    return running;
  }

  const runQueued = async (): Promise<T> => {
    state.queued = undefined;
    return runSerially(state, f);
  };
  const queued = state.running.then(runQueued, runQueued);
  state.queued = queued;
  return queued;
}

export async function reloadAllCssIfNeeded(
  originalStyles: WeakMap<CSSStyleRule, string>,
): Promise<boolean> {
  const results = await Promise.allSettled(
    Array.from(document.styleSheets, (styleSheet) =>
      reloadCssIfNeeded(originalStyles, styleSheet),
    ),
  );
  return results.some(
    (result) => result.status === "fulfilled" && result.value,
  );
}

async function reloadCssIfNeeded(
  originalStyles: WeakMap<CSSStyleRule, string>,
  styleSheet: CSSStyleSheet,
): Promise<boolean> {
  if (styleSheet.href === null) {
    return false;
  }

  const url = makeUrl(styleSheet.href);
  if (
    url === undefined ||
    url.host !== window.location.host ||
    // Don’t try to reload our own temporary style sheets (see `parseCssWithImports`).
    url.searchParams.has(RELOAD_PARAM)
  ) {
    return false;
  }

  const response = await fetch(url, { cache: "reload" });
  if (!response.ok) {
    return false;
  }

  const newCss = await response.text();

  if (isFirefox() && /@import\b/i.test(newCss)) {
    // oxlint-disable-next-line no-console
    console.warn(
      "elm-watch: In Firefox, @import:ed CSS files are not hot reloaded due to over eager caching by Firefox. Style sheet:",
      url.href,
    );
  }

  const importUrls = isFirefox() ? [] : getAllCssImports(url, styleSheet);
  await Promise.allSettled(
    importUrls.map((importUrl) => fetch(importUrl, { cache: "reload" })),
  );
  const newStyleSheet = await parseCssWithImports(url);

  return newStyleSheet === undefined
    ? false
    : updateStyleSheetIfNeeded(originalStyles, styleSheet, newStyleSheet);
}

const RELOAD_PARAM = "elm-watch-css-reload";

// Note: It might seem possible to parse using:
// `const styleSheet = new CSSStyleSheet(); styleSheet.replaceSync(css);`
// However, that does not support `@import`:
// https://github.com/WICG/construct-stylesheets/issues/119#issuecomment-588362382
// Also, at the time of writing, Safari did not support constructing
// `CSSStyleSheet`.
// Instead, we load the style sheet in a temporary `<link>`. That way relative
// `@import`:s are resolved relative to the style sheet, without affecting the
// rest of the document. (A `<style>` with the CSS text would need a `<base>`
// element, which changes how _all_ relative URL:s in the document are resolved
// while it is present.) The query parameter makes sure that we get a fresh
// copy of the style sheet rather than one the browser has cached in memory.
async function parseCssWithImports(
  styleSheetUrl: URL,
): Promise<CSSStyleSheet | undefined> {
  return new Promise((resolve) => {
    const url = new URL(styleSheetUrl);
    url.searchParams.set(RELOAD_PARAM, Date.now().toString());

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.media = "print";
    link.href = url.href;

    // The "load" event fires when all the CSS has been parsed, including
    // `@import`s. Some browsers fire the "error" event instead if an `@import`
    // fails, so we use whatever we got in that case too.
    link.onerror = link.onload = () => {
      resolve(link.sheet ?? undefined);
      link.remove();
    };

    document.head.append(link);
  });
}

function makeUrl(urlString: string, base?: URL): URL | undefined {
  try {
    return new URL(urlString, base);
  } catch {
    return undefined;
  }
}

function getAllCssImports(
  styleSheetUrl: URL,
  styleSheet: CSSStyleSheet,
): Array<URL> {
  return Array.from(styleSheet.cssRules).flatMap((rule) => {
    if (rule instanceof CSSImportRule && rule.styleSheet !== null) {
      const url = makeUrl(rule.href, styleSheetUrl);
      if (url !== undefined && url.host === styleSheetUrl.host) {
        return [url, ...getAllCssImports(url, rule.styleSheet)];
      }
    }
    return [];
  });
}

/**
 * This function does nothing if the CSS is unchanged. That’s important because
 * reloading the whole `<link>` tag can cause a flash of unstyled content, and
 * reset any temporary changes you have done in the inspector. This is run when
 * _any_ CSS file changes – which might not even be related to this page – or
 * on `visibilitychange` which includes switching between tabs.
 * The “diffing” algorithm is very simple: For identical CSS it does nothing.
 * For a single changed rule (very common), only that rule is updated. In
 * other cases it might replace more rules than strictly needed but it doesn't
 * matter.
 */
function updateStyleSheetIfNeeded(
  originalStyles: WeakMap<CSSStyleRule, string>,
  oldStyleSheet: Pick<CSSStyleSheet, "cssRules" | "deleteRule" | "insertRule">,
  newStyleSheet: Pick<CSSStyleSheet, "cssRules" | "deleteRule" | "insertRule">,
): boolean {
  let changed = false;
  const length = Math.min(
    oldStyleSheet.cssRules.length,
    newStyleSheet.cssRules.length,
  );
  /* oxlint-disable typescript/no-non-null-assertion */
  let index = 0;
  for (; index < length; index++) {
    const oldRule = oldStyleSheet.cssRules[index]!;
    const newRule = newStyleSheet.cssRules[index]!;
    if (oldRule instanceof CSSStyleRule && newRule instanceof CSSStyleRule) {
      if (oldRule.selectorText !== newRule.selectorText) {
        oldRule.selectorText = newRule.selectorText;
        changed = true;
      }
      let originals = originalStyles.get(oldRule);
      if (originals === undefined) {
        originals = oldRule.style.cssText;
        originalStyles.set(oldRule, originals);
      }
      // We compare the original CSS, not the current CSS, because the current
      // CSS might have been changed by the user in the devtools.
      if (originals !== newRule.style.cssText) {
        oldStyleSheet.deleteRule(index);
        oldStyleSheet.insertRule(newRule.cssText, index);
        originalStyles.set(
          oldStyleSheet.cssRules[index] as CSSStyleRule,
          newRule.style.cssText,
        );
        changed = true;
      } else {
        const nestedChanged = updateStyleSheetIfNeeded(
          originalStyles,
          oldRule,
          newRule,
        );
        if (nestedChanged) {
          changed = true;
          // Workaround for Chrome: Nested rules are not updated otherwise.
          oldRule.selectorText = oldRule.selectorText;
        }
      }
    } else if (
      oldRule instanceof CSSImportRule &&
      newRule instanceof CSSImportRule &&
      oldRule.cssText === newRule.cssText &&
      // Exclude Firefox since imported style sheets often returned old, cached versions.
      !isFirefox()
    ) {
      const nestedChanged =
        oldRule.styleSheet !== null && newRule.styleSheet !== null
          ? updateStyleSheetIfNeeded(
              originalStyles,
              oldRule.styleSheet,
              newRule.styleSheet,
            )
          : !(oldRule.styleSheet === null && newRule.styleSheet === null);
      if (nestedChanged) {
        changed = true;
        // Workaround for Chrome: Only the first update to the imported style
        // sheet is reflected otherwise.
        // @ts-expect-error TypeScript says `.media` is readonly, but it’s fine
        // to set it.
        oldRule.media = oldRule.media;
      }
    } else if (
      // @media, @supports and @container:
      (oldRule instanceof CSSConditionRule &&
        newRule instanceof CSSConditionRule &&
        oldRule.conditionText === newRule.conditionText) ||
      // @layer:
      (oldRule instanceof CSSLayerBlockRule &&
        newRule instanceof CSSLayerBlockRule &&
        oldRule.name === newRule.name) ||
      // @page:
      (oldRule instanceof CSSPageRule &&
        newRule instanceof CSSPageRule &&
        oldRule.selectorText === newRule.selectorText)
    ) {
      const nestedChanged = updateStyleSheetIfNeeded(
        originalStyles,
        oldRule,
        newRule,
      );
      if (nestedChanged) {
        changed = true;
      }
      // The fallback below works for any rule, but is more destructive.
    } else if (oldRule.cssText !== newRule.cssText) {
      oldStyleSheet.deleteRule(index);
      oldStyleSheet.insertRule(newRule.cssText, index);
      changed = true;
    }
  }
  while (index < oldStyleSheet.cssRules.length) {
    oldStyleSheet.deleteRule(index);
    changed = true;
  }
  for (; index < newStyleSheet.cssRules.length; index++) {
    const newRule = newStyleSheet.cssRules[index]!;
    oldStyleSheet.insertRule(newRule.cssText, index);
    changed = true;
  }
  /* oxlint-enable typescript/no-non-null-assertion */
  return changed;
}

// Note: We can't use the user agent to detect Firefox, because this needs to work
// even when the responsive design mode is enabled (which also swaps the user agent).
function isFirefox(): boolean {
  return typeof (window as { scrollMaxX?: number }).scrollMaxX === "number";
}
