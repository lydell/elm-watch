import { describe, expect, test } from "vitest";

import type { Color } from "../src/ElmMakeError.ts";
import * as Errors from "../src/Errors.ts";
import type { Theme } from "../src/Theme.ts";
import { markAsTargetName } from "../src/Types.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

const COLORS: Array<Color> = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "BLACK",
  "RED",
  "GREEN",
  "YELLOW",
  "BLUE",
  "MAGENTA",
  "CYAN",
  "WHITE",
];

const theme: Theme = {
  foreground: "white",
  background: "black",
  palette: Object.fromEntries(
    COLORS.map((color) => [color, color]),
  ) as Theme["palette"],
};

// Elm’s error messages contain links like `<https://elm-lang.org/0.19.1/imports>`.
const errorTemplate = Errors.postprocessFunctionError(
  { tag: "PackageTarget", targetName: markAsTargetName("Main") },
  "Read <https://elm-lang.org/0.19.1/imports> & <b>stuff</b>",
);

describe("toHtml", () => {
  test("escapes HTML", () => {
    expect(Errors.toHtml(errorTemplate, theme, false).htmlContent)
      .toMatchInlineSnapshot(`
        I ran your postprocess function for this target.

        <b>It threw an error:</b>

        Read &lt;https://elm-lang.org/0.19.1/imports&gt; &amp; &lt;b&gt;stuff&lt;/b&gt;
      `);
  });

  test("escapes HTML with NO_COLOR", () => {
    expect(Errors.toHtml(errorTemplate, theme, true).htmlContent)
      .toMatchInlineSnapshot(`
        I ran your postprocess function for this target.

        It threw an error:

        Read &lt;https://elm-lang.org/0.19.1/imports&gt; &amp; &lt;b&gt;stuff&lt;/b&gt;
      `);
  });
});
