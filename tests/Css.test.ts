import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  runSerially,
  type SerialState,
  updateStyleSheetIfNeeded,
} from "../client/css.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// A tiny fake CSSOM. jsdom’s CSSOM is too incomplete: It lacks for example
// `CSSConditionRule` and `CSSLayerBlockRule`. Real browsers are needed to test
// the browser specific workarounds anyway. These tests are about the “diffing”.

// Every mutation is logged, so that the tests can check that only what is
// needed is updated.
let log: Array<string> = [];

// `insertRule` takes CSS text, which would need a parser. Instead, we look up
// the rule with the same CSS text among all rules created so far.
let allRules: Array<FakeRule> = [];

type Container = {
  label: string;
  cssRules: Array<FakeRule>;
};

function insertRuleInto(
  container: Container,
  cssText: string,
  index: number,
): number {
  const rule = allRules.find((r) => r.cssText === cssText);
  if (rule === undefined) {
    throw new Error(`insertRule: Unknown CSS: ${cssText}`);
  }
  log.push(`${container.label}: insert ${index}: ${cssText}`);
  container.cssRules.splice(index, 0, rule.clone());
  return index;
}

function deleteRuleFrom(container: Container, index: number): void {
  log.push(`${container.label}: delete ${index}`);
  container.cssRules.splice(index, 1);
}

function block(prelude: string, parts: Array<string>): string {
  const content = parts.filter((part) => part !== "").join(" ");
  return content === "" ? `${prelude} {}` : `${prelude} { ${content} }`;
}

abstract class FakeRule {
  constructor() {
    allRules.push(this);
  }

  abstract get cssText(): string;

  abstract clone(): FakeRule;
}

class FakeStyleSheet {
  label: string;

  cssRules: Array<FakeRule>;

  constructor(cssRules: Array<FakeRule>, label = "sheet") {
    this.cssRules = cssRules;
    this.label = label;
  }

  insertRule(cssText: string, index: number): number {
    return insertRuleInto(this, cssText, index);
  }

  deleteRule(index: number): void {
    deleteRuleFrom(this, index);
  }

  toString(): string {
    return this.cssRules
      .map((rule) =>
        rule instanceof FakeImportRule && rule.styleSheet !== null
          ? `${rule.cssText} /* ${rule.styleSheet.toString()} */`
          : rule.cssText,
      )
      .join("\n");
  }
}

class FakeStyleRule extends FakeRule {
  #selectorText: string;

  style: { cssText: string };

  cssRules: Array<FakeRule>;

  constructor(selectorText: string, style: string, cssRules: Array<FakeRule>) {
    super();
    this.#selectorText = selectorText;
    this.style = { cssText: style };
    this.cssRules = cssRules;
  }

  get selectorText(): string {
    return this.#selectorText;
  }

  set selectorText(selectorText: string) {
    log.push(`${this.#selectorText}: set selectorText to ${selectorText}`);
    this.#selectorText = selectorText;
  }

  get label(): string {
    return this.#selectorText;
  }

  get cssText(): string {
    return block(this.#selectorText, [
      this.style.cssText,
      ...this.cssRules.map((rule) => rule.cssText),
    ]);
  }

  clone(): FakeStyleRule {
    return new FakeStyleRule(
      this.#selectorText,
      this.style.cssText,
      this.cssRules.map((rule) => rule.clone()),
    );
  }

  insertRule(cssText: string, index: number): number {
    return insertRuleInto(this, cssText, index);
  }

  deleteRule(index: number): void {
    deleteRuleFrom(this, index);
  }
}

class FakeConditionRule extends FakeRule {
  conditionText: string;

  cssRules: Array<FakeRule>;

  constructor(conditionText: string, cssRules: Array<FakeRule>) {
    super();
    this.conditionText = conditionText;
    this.cssRules = cssRules;
  }

  get label(): string {
    return `@media ${this.conditionText}`;
  }

  get cssText(): string {
    return block(
      this.label,
      this.cssRules.map((rule) => rule.cssText),
    );
  }

  clone(): FakeConditionRule {
    return new FakeConditionRule(
      this.conditionText,
      this.cssRules.map((rule) => rule.clone()),
    );
  }

  insertRule(cssText: string, index: number): number {
    return insertRuleInto(this, cssText, index);
  }

  deleteRule(index: number): void {
    deleteRuleFrom(this, index);
  }
}

class FakeLayerBlockRule extends FakeRule {
  name: string;

  cssRules: Array<FakeRule>;

  constructor(name: string, cssRules: Array<FakeRule>) {
    super();
    this.name = name;
    this.cssRules = cssRules;
  }

  get label(): string {
    return `@layer ${this.name}`;
  }

  get cssText(): string {
    return block(
      this.label,
      this.cssRules.map((rule) => rule.cssText),
    );
  }

  clone(): FakeLayerBlockRule {
    return new FakeLayerBlockRule(
      this.name,
      this.cssRules.map((rule) => rule.clone()),
    );
  }

  insertRule(cssText: string, index: number): number {
    return insertRuleInto(this, cssText, index);
  }

  deleteRule(index: number): void {
    deleteRuleFrom(this, index);
  }
}

class FakeImportRule extends FakeRule {
  href: string;

  styleSheet: FakeStyleSheet | null;

  #media = "";

  constructor(href: string, styleSheet: FakeStyleSheet | null) {
    super();
    this.href = href;
    this.styleSheet = styleSheet;
  }

  get media(): string {
    return this.#media;
  }

  set media(media: string) {
    log.push(`${this.cssText}: set media`);
    this.#media = media;
  }

  get cssText(): string {
    return `@import url("${this.href}");`;
  }

  clone(): FakeImportRule {
    return new FakeImportRule(
      this.href,
      this.styleSheet === null
        ? null
        : new FakeStyleSheet(
            this.styleSheet.cssRules.map((rule) => rule.clone()),
            this.styleSheet.label,
          ),
    );
  }
}

// For example `@keyframes` or `@font-face`.
class FakeOtherRule extends FakeRule {
  #cssText: string;

  constructor(cssText: string) {
    super();
    this.#cssText = cssText;
  }

  get cssText(): string {
    return this.#cssText;
  }

  clone(): FakeOtherRule {
    return new FakeOtherRule(this.#cssText);
  }
}

// Never instantiated, but needed for `instanceof`.
class FakePageRule extends FakeRule {
  get cssText(): string {
    return "@page {}";
  }

  clone(): FakePageRule {
    return new FakePageRule();
  }
}

function sheet(...cssRules: Array<FakeRule>): FakeStyleSheet {
  return new FakeStyleSheet(cssRules);
}

function styleRule(
  selectorText: string,
  style: string,
  ...cssRules: Array<FakeRule>
): FakeStyleRule {
  return new FakeStyleRule(selectorText, style, cssRules);
}

function mediaRule(
  conditionText: string,
  ...cssRules: Array<FakeRule>
): FakeConditionRule {
  return new FakeConditionRule(conditionText, cssRules);
}

function layer(name: string, ...cssRules: Array<FakeRule>): FakeLayerBlockRule {
  return new FakeLayerBlockRule(name, cssRules);
}

function cssImport(href: string, ...cssRules: Array<FakeRule>): FakeImportRule {
  return new FakeImportRule(href, new FakeStyleSheet(cssRules, href));
}

function other(cssText: string): FakeOtherRule {
  return new FakeOtherRule(cssText);
}

type FakeOriginalStyles = WeakMap<FakeStyleRule, string>;

function update(
  originalStyles: FakeOriginalStyles,
  oldStyleSheet: FakeStyleSheet,
  newStyleSheet: FakeStyleSheet,
): string {
  log = [];
  const changed = updateStyleSheetIfNeeded(
    originalStyles as unknown as WeakMap<CSSStyleRule, string>,
    oldStyleSheet as unknown as CSSStyleSheet,
    newStyleSheet as unknown as CSSStyleSheet,
  );
  return [
    `changed: ${String(changed)}`,
    ...log,
    "--- result:",
    oldStyleSheet.toString(),
  ].join("\n");
}

function updateOnce(
  oldStyleSheet: FakeStyleSheet,
  newStyleSheet: FakeStyleSheet,
): string {
  return update(new WeakMap(), oldStyleSheet, newStyleSheet);
}

describe("updateStyleSheetIfNeeded", () => {
  beforeEach(() => {
    log = [];
    allRules = [];
    vi.stubGlobal("CSSStyleRule", FakeStyleRule);
    vi.stubGlobal("CSSConditionRule", FakeConditionRule);
    vi.stubGlobal("CSSLayerBlockRule", FakeLayerBlockRule);
    vi.stubGlobal("CSSImportRule", FakeImportRule);
    vi.stubGlobal("CSSPageRule", FakePageRule);
    // Not Firefox (see `isFirefox`).
    vi.stubGlobal("window", {});
    return () => {
      vi.unstubAllGlobals();
    };
  });

  test("identical", () => {
    expect(
      updateOnce(
        sheet(
          styleRule("a", "color: red;"),
          mediaRule("print", styleRule("b", "color: blue;")),
        ),
        sheet(
          styleRule("a", "color: red;"),
          mediaRule("print", styleRule("b", "color: blue;")),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      a { color: red; }
      @media print { b { color: blue; } }
    `);
  });

  test("empty", () => {
    expect(updateOnce(sheet(), sheet())).toMatchInlineSnapshot(`
      changed: false
      --- result:
    `);
  });

  test("changed declaration: only that rule is replaced", () => {
    const oldStyleSheet = sheet(
      styleRule("a", "color: red;"),
      styleRule("b", "color: red;"),
      styleRule("c", "color: red;"),
    );
    const [a, , c] = oldStyleSheet.cssRules;
    expect(
      updateOnce(
        oldStyleSheet,
        sheet(
          styleRule("a", "color: red;"),
          styleRule("b", "color: blue;"),
          styleRule("c", "color: red;"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 1
      sheet: insert 1: b { color: blue; }
      --- result:
      a { color: red; }
      b { color: blue; }
      c { color: red; }
    `);
    expect(oldStyleSheet.cssRules[0]).toBe(a);
    expect(oldStyleSheet.cssRules[2]).toBe(c);
  });

  test("changed selector: only the selector is updated", () => {
    const oldStyleSheet = sheet(styleRule("a", "color: red;"));
    const [a] = oldStyleSheet.cssRules;
    expect(
      updateOnce(oldStyleSheet, sheet(styleRule("a:hover", "color: red;"))),
    ).toMatchInlineSnapshot(`
      changed: true
      a: set selectorText to a:hover
      --- result:
      a:hover { color: red; }
    `);
    expect(oldStyleSheet.cssRules[0]).toBe(a);
  });

  test("changed selector and declaration", () => {
    expect(
      updateOnce(
        sheet(styleRule("a", "color: red;")),
        sheet(styleRule("b", "color: blue;")),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      a: set selectorText to b
      sheet: delete 0
      sheet: insert 0: b { color: blue; }
      --- result:
      b { color: blue; }
    `);
  });

  test("added rules at the end", () => {
    expect(
      updateOnce(
        sheet(styleRule("a", "color: red;")),
        sheet(
          styleRule("a", "color: red;"),
          styleRule("b", "color: blue;"),
          styleRule("c", ""),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: insert 1: b { color: blue; }
      sheet: insert 2: c {}
      --- result:
      a { color: red; }
      b { color: blue; }
      c {}
    `);
  });

  test("removed rules at the end", () => {
    expect(
      updateOnce(
        sheet(
          styleRule("a", "color: red;"),
          styleRule("b", "color: blue;"),
          styleRule("c", ""),
        ),
        sheet(styleRule("a", "color: red;")),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 1
      sheet: delete 1
      --- result:
      a { color: red; }
    `);
  });

  test("everything after an added rule is replaced (diffing is by index)", () => {
    expect(
      updateOnce(
        sheet(styleRule("a", "color: red;"), styleRule("b", "color: blue;")),
        sheet(
          styleRule("new", "color: green;"),
          styleRule("a", "color: red;"),
          styleRule("b", "color: blue;"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      a: set selectorText to new
      sheet: delete 0
      sheet: insert 0: new { color: green; }
      b: set selectorText to a
      sheet: delete 1
      sheet: insert 1: a { color: red; }
      sheet: insert 2: b { color: blue; }
      --- result:
      new { color: green; }
      a { color: red; }
      b { color: blue; }
    `);
  });

  test("everything to empty", () => {
    expect(
      updateOnce(
        sheet(styleRule("a", "color: red;"), styleRule("b", "color: blue;")),
        sheet(),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: delete 0
      --- result:
    `);
  });

  test("edits made in the devtools are preserved, unless the rule changes", () => {
    const originalStyles: FakeOriginalStyles = new WeakMap();
    const oldStyleSheet = sheet(
      styleRule("a", "color: red;"),
      styleRule("b", "color: red;"),
    );
    const makeNewStyleSheet = (b: string): FakeStyleSheet =>
      sheet(styleRule("a", "color: red;"), styleRule("b", b));

    // The first update remembers the original styles.
    expect(
      update(originalStyles, oldStyleSheet, makeNewStyleSheet("color: red;")),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      a { color: red; }
      b { color: red; }
    `);

    // Simulate editing in the devtools.
    for (const rule of oldStyleSheet.cssRules as Array<FakeStyleRule>) {
      rule.style.cssText = "color: hotpink;";
    }

    // CSS file unchanged: Keep devtools edits.
    expect(
      update(originalStyles, oldStyleSheet, makeNewStyleSheet("color: red;")),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      a { color: hotpink; }
      b { color: hotpink; }
    `);

    // `b` changed in the CSS file: Only `a` keeps the devtools edit.
    expect(
      update(originalStyles, oldStyleSheet, makeNewStyleSheet("color: blue;")),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 1
      sheet: insert 1: b { color: blue; }
      --- result:
      a { color: hotpink; }
      b { color: blue; }
    `);

    // Same CSS file again: No changes (the replaced `b` rule must be remembered
    // with its new original styles).
    expect(
      update(originalStyles, oldStyleSheet, makeNewStyleSheet("color: blue;")),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      a { color: hotpink; }
      b { color: blue; }
    `);
  });

  test("@media: changes inside are updated recursively", () => {
    const oldStyleSheet = sheet(
      mediaRule(
        "(min-width: 100px)",
        styleRule("a", "color: red;"),
        styleRule("b", "color: red;"),
      ),
    );
    const [oldMediaRule] = oldStyleSheet.cssRules;
    expect(
      updateOnce(
        oldStyleSheet,
        sheet(
          mediaRule(
            "(min-width: 100px)",
            styleRule("a", "color: red;"),
            styleRule("b", "color: blue;"),
          ),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      @media (min-width: 100px): delete 1
      @media (min-width: 100px): insert 1: b { color: blue; }
      --- result:
      @media (min-width: 100px) { a { color: red; } b { color: blue; } }
    `);
    expect(oldStyleSheet.cssRules[0]).toBe(oldMediaRule);
  });

  test("@media: changed condition replaces the whole rule", () => {
    expect(
      updateOnce(
        sheet(mediaRule("(min-width: 100px)", styleRule("a", "color: red;"))),
        sheet(mediaRule("(min-width: 200px)", styleRule("a", "color: red;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: insert 0: @media (min-width: 200px) { a { color: red; } }
      --- result:
      @media (min-width: 200px) { a { color: red; } }
    `);
  });

  test("@layer: changes inside are updated recursively", () => {
    expect(
      updateOnce(
        sheet(layer("base", styleRule("a", "color: red;"))),
        sheet(layer("base", styleRule("a", "color: blue;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      @layer base: delete 0
      @layer base: insert 0: a { color: blue; }
      --- result:
      @layer base { a { color: blue; } }
    `);
  });

  test("@layer: changed name replaces the whole rule", () => {
    expect(
      updateOnce(
        sheet(layer("base", styleRule("a", "color: red;"))),
        sheet(layer("components", styleRule("a", "color: red;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: insert 0: @layer components { a { color: red; } }
      --- result:
      @layer components { a { color: red; } }
    `);
  });

  test("nested style rules are updated recursively", () => {
    expect(
      updateOnce(
        sheet(
          styleRule("a", "color: red;", styleRule("&:hover", "color: red;")),
        ),
        sheet(
          styleRule("a", "color: red;", styleRule("&:hover", "color: blue;")),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      a: delete 0
      a: insert 0: &:hover { color: blue; }
      a: set selectorText to a
      --- result:
      a { color: red; &:hover { color: blue; } }
    `);
  });

  test("changed declaration in a rule with nested rules replaces the whole rule", () => {
    expect(
      updateOnce(
        sheet(
          styleRule("a", "color: red;", styleRule("&:hover", "color: red;")),
        ),
        sheet(
          styleRule("a", "color: blue;", styleRule("&:hover", "color: red;")),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: insert 0: a { color: blue; &:hover { color: red; } }
      --- result:
      a { color: blue; &:hover { color: red; } }
    `);
  });

  test("other rules are replaced only if changed", () => {
    expect(
      updateOnce(
        sheet(
          other("@keyframes spin { to { rotate: 1turn; } }"),
          other("@font-face { font-family: X; }"),
        ),
        sheet(
          other("@keyframes spin { to { rotate: 1turn; } }"),
          other("@font-face { font-family: Y; }"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 1
      sheet: insert 1: @font-face { font-family: Y; }
      --- result:
      @keyframes spin { to { rotate: 1turn; } }
      @font-face { font-family: Y; }
    `);
  });

  test("different kinds of rules at the same index", () => {
    expect(
      updateOnce(
        sheet(
          styleRule("a", "color: red;"),
          mediaRule("print", styleRule("a", "color: red;")),
        ),
        sheet(
          mediaRule("print", styleRule("a", "color: red;")),
          styleRule("a", "color: red;"),
        ),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: insert 0: @media print { a { color: red; } }
      sheet: delete 1
      sheet: insert 1: a { color: red; }
      --- result:
      @media print { a { color: red; } }
      a { color: red; }
    `);
  });

  test("@import: changes in the imported style sheet are updated recursively", () => {
    expect(
      updateOnce(
        sheet(cssImport("other.css", styleRule("a", "color: red;"))),
        sheet(cssImport("other.css", styleRule("a", "color: blue;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      other.css: delete 0
      other.css: insert 0: a { color: blue; }
      @import url("other.css");: set media
      --- result:
      @import url("other.css"); /* a { color: blue; } */
    `);
  });

  test("@import: unchanged imported style sheet", () => {
    expect(
      updateOnce(
        sheet(cssImport("other.css", styleRule("a", "color: red;"))),
        sheet(cssImport("other.css", styleRule("a", "color: red;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      @import url("other.css"); /* a { color: red; } */
    `);
  });

  test("@import: imported style sheet not loaded", () => {
    expect(
      updateOnce(
        sheet(cssImport("other.css", styleRule("a", "color: red;"))),
        sheet(new FakeImportRule("other.css", null)),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      @import url("other.css");: set media
      --- result:
      @import url("other.css"); /* a { color: red; } */
    `);
  });

  test("@import: changed URL replaces the rule", () => {
    expect(
      updateOnce(
        sheet(cssImport("one.css", styleRule("a", "color: red;"))),
        sheet(cssImport("two.css", styleRule("a", "color: blue;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: true
      sheet: delete 0
      sheet: insert 0: @import url("two.css");
      --- result:
      @import url("two.css"); /* a { color: blue; } */
    `);
  });

  test("@import: Firefox does not look inside imported style sheets", () => {
    vi.stubGlobal("window", { scrollMaxX: 0 });
    expect(
      updateOnce(
        sheet(cssImport("other.css", styleRule("a", "color: red;"))),
        sheet(cssImport("other.css", styleRule("a", "color: blue;"))),
      ),
    ).toMatchInlineSnapshot(`
      changed: false
      --- result:
      @import url("other.css"); /* a { color: red; } */
    `);
  });
});

describe("runSerially", () => {
  function nth<T>(items: Array<T>, index: number): T {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`No item at index ${index}`);
    }
    return item;
  }

  type Deferred = {
    promise: Promise<string>;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  };

  function setup(): {
    state: SerialState<string>;
    run: () => Promise<string>;
    calls: Array<Deferred>;
  } {
    const state: SerialState<string> = {
      running: undefined,
      queued: undefined,
    };
    const calls: Array<Deferred> = [];
    const f = async (): Promise<string> => {
      let resolve: Deferred["resolve"] = () => undefined;
      let reject: Deferred["reject"] = () => undefined;
      const promise = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      calls.push({ promise, resolve, reject });
      return promise;
    };
    return { state, run: () => runSerially(state, f), calls };
  }

  test("runs immediately when idle", async () => {
    const { state, run, calls } = setup();
    const promise = run();
    expect(calls).toHaveLength(1);
    nth(calls, 0).resolve("first");
    expect(await promise).toBe("first");
    expect(state).toEqual({ running: undefined, queued: undefined });

    // Runs immediately again after being done.
    const promise2 = run();
    expect(calls).toHaveLength(2);
    nth(calls, 1).resolve("second");
    expect(await promise2).toBe("second");
  });

  test("queues a run while running, and shares the queued run", async () => {
    const { state, run, calls } = setup();
    const promise1 = run();
    const promise2 = run();
    const promise3 = run();
    expect(calls).toHaveLength(1);

    nth(calls, 0).resolve("first");
    expect(await promise1).toBe("first");
    // Let the queued run start.
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    // A call while the queued run is running queues yet another run.
    const promise4 = run();

    nth(calls, 1).resolve("second");
    expect(await promise2).toBe("second");
    expect(await promise3).toBe("second");
    await vi.waitFor(() => {
      expect(calls).toHaveLength(3);
    });

    nth(calls, 2).resolve("third");
    expect(await promise4).toBe("third");
    expect(calls).toHaveLength(3);
    expect(state).toEqual({ running: undefined, queued: undefined });
  });

  test("runs the queued run even if the current run fails", async () => {
    const { state, run, calls } = setup();
    const promise1 = run();
    const promise2 = run();

    nth(calls, 0).reject(new Error("fail"));
    await expect(promise1).rejects.toThrow("fail");
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });

    nth(calls, 1).resolve("second");
    expect(await promise2).toBe("second");
    expect(state).toEqual({ running: undefined, queued: undefined });
  });
});
