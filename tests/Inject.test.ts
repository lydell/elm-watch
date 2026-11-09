import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

import { inject } from "../src/Inject.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "inject");

// `_Browser_application`, `_Browser_document` and `_Debugger_document` from an
// application compiled with `--debug`, with elm/browser 1.0.2 and
// elm/virtual-dom 1.0.5, versus the `safe` branches of lydell/browser and
// lydell/virtual-dom.
function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8");
}

function linesOnlyIn(a: string, b: string): Array<string> {
  const bLines = new Set(b.split("\n"));
  return a.split("\n").filter((line) => !bLines.has(line));
}

describe("inject", () => {
  const elmBrowser = inject("debug", readFixture("elm-browser.js"));
  const lydellBrowserSafe = inject(
    "debug",
    readFixture("lydell-browser-safe.js"),
  );

  test("all functions were replaced", () => {
    expect(elmBrowser).not.toMatch("elm-watch ERROR");
    expect(lydellBrowserSafe).not.toMatch("elm-watch ERROR");
  });

  test("elm/browser does not get lydell/browser@safe changes", () => {
    expect(elmBrowser).not.toMatch("lydell/browser@safe");
    expect(elmBrowser).not.toMatch("hasAttribute('href')");
  });

  test("lydell/browser@safe changes are kept", () => {
    expect(linesOnlyIn(lydellBrowserSafe, elmBrowser).join("\n"))
      .toMatchInlineSnapshot(`
        "			_VirtualDom_divertHrefToApp = divertHrefToApp; // added by lydell/browser@safe
        			_VirtualDom_divertHrefToApp = 0; // added by lydell/browser@safe
        			_VirtualDom_divertHrefToApp = divertHrefToApp; // added by lydell/browser@safe
        			_VirtualDom_divertHrefToApp = 0; // added by lydell/browser@safe
        				if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button < 1 && !domNode.target && !domNode.hasAttribute('download') && domNode.hasAttribute('href')) // changed by lydell/browser@safe"
      `);
    expect(
      linesOnlyIn(elmBrowser, lydellBrowserSafe).join("\n"),
    ).toMatchInlineSnapshot(
      `"				if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button < 1 && !domNode.target && !domNode.hasAttribute('download'))"`,
    );
  });
});
