import { describe, expect, test } from "vitest";

import { ansiToHtml } from "../src/AnsiToHtml.ts";
import { sanitizeTerminalText } from "../src/Helpers.ts";
import { DEFAULT_THEME } from "../src/Theme.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

function toHtml(text: string): string {
  return ansiToHtml(sanitizeTerminalText(text).withColor, DEFAULT_THEME);
}

describe("ansiToHtml", () => {
  test("plain text is escaped", () => {
    expect(toHtml("a < b && c")).toBe("a &lt; b &amp;&amp; c");
  });

  test("basic colors come from the theme", () => {
    expect(
      toHtml("\x1B[31mred\x1B[39m \x1B[91mbright\x1B[0m \x1B[42mbg\x1B[49m"),
    ).toMatchInlineSnapshot(
      `<span style="color: rgb(205, 49, 49)">red</span> <span style="color: rgb(241, 76, 76)">bright</span> <span style="background-color: rgb(13, 188, 121)">bg</span>`,
    );
  });

  test("styles, and turning them off", () => {
    expect(
      toHtml(
        "\x1B[1mbold\x1B[22m \x1B[2mdim\x1B[22m \x1B[3mitalic\x1B[23m \x1B[4;9mboth\x1B[24m strike\x1B[29m done",
      ),
    ).toMatchInlineSnapshot(
      `<span style="font-weight: bold">bold</span> <span style="opacity: 0.6">dim</span> <span style="font-style: italic">italic</span> <span style="text-decoration: underline line-through">both</span><span style="text-decoration: line-through"> strike</span> done`,
    );
  });

  test("256 colors and true color", () => {
    expect(
      toHtml(
        "\x1B[38;5;9ma\x1B[38;5;196mb\x1B[38;5;244mc\x1B[48;2;1;2;3md\x1B[38:2::4:5:6me\x1B[38:5:2mf",
      ),
    ).toMatchInlineSnapshot(
      `<span style="color: rgb(241, 76, 76)">a</span><span style="color: rgb(255, 0, 0)">b</span><span style="color: rgb(128, 128, 128)">c</span><span style="color: rgb(128, 128, 128); background-color: rgb(1, 2, 3)">d</span><span style="color: rgb(4, 5, 6); background-color: rgb(1, 2, 3)">e</span><span style="color: rgb(13, 188, 121); background-color: rgb(1, 2, 3)">f</span>`,
    );
  });

  test("inverse", () => {
    expect(
      toHtml("\x1B[7minverse\x1B[31m red\x1B[27m back"),
    ).toMatchInlineSnapshot(
      `<span style="color: rgb(32, 30, 30); background-color: rgb(204, 204, 204)">inverse</span><span style="color: rgb(32, 30, 30); background-color: rgb(205, 49, 49)"> red</span><span style="color: rgb(205, 49, 49)"> back</span>`,
    );
  });

  test("bad and unknown codes are ignored", () => {
    expect(
      toHtml("\x1B[38;5;999ma\x1B[38;2;1;2mb\x1B[5;53mc\x1B[mreset"),
    ).toMatchInlineSnapshot(`abcreset`);
  });

  test("underline colors are skipped", () => {
    expect(
      toHtml("\x1B[1;58;2;255;0;0ma\x1B[58;5;0mb\x1B[58:2::1:2:3mc"),
    ).toMatchInlineSnapshot(
      `<span style="font-weight: bold">a</span><span style="font-weight: bold">b</span><span style="font-weight: bold">c</span>`,
    );
  });

  test("underline styles", () => {
    expect(
      toHtml("\x1B[4:3mcurly\x1B[4:0mplain\x1B[4:9mstill\x1B[4mstraight"),
    ).toMatchInlineSnapshot(
      `<span style="text-decoration: underline">curly</span>plainstill<span style="text-decoration: underline">straight</span>`,
    );
  });

  test("leading zeros", () => {
    expect(toHtml("\x1B[038;5;1ma\x1B[038:2::1:2:3mb")).toMatchInlineSnapshot(
      `<span style="color: rgb(205, 49, 49)">a</span><span style="color: rgb(1, 2, 3)">b</span>`,
    );
  });

  test("esbuild", () => {
    expect(
      toHtml(
        '\x1B[31m✘ \x1B[41;31m[\x1B[41;97mERROR\x1B[41;31m]\x1B[0m \x1B[1mExpected ";" but found "foo"\x1B[0m\n\n    ts/main.ts:15:8:\n\x1B[37m      15 │ const x \x1B[32mfoo\x1B[37m = 1;\n         │         \x1B[32m~~~\x1B[37m\n         ╵         \x1B[32m;\x1B[0m\n',
      ),
    ).toMatchInlineSnapshot(`
      <span style="color: rgb(205, 49, 49)">✘ </span><span style="color: rgb(205, 49, 49); background-color: rgb(205, 49, 49)">[</span><span style="color: rgb(229, 229, 229); background-color: rgb(205, 49, 49)">ERROR</span><span style="color: rgb(205, 49, 49); background-color: rgb(205, 49, 49)">]</span> <span style="font-weight: bold">Expected &quot;;&quot; but found &quot;foo&quot;</span>

          ts/main.ts:15:8:
      <span style="color: rgb(229, 229, 229)">      15 │ const x </span><span style="color: rgb(13, 188, 121)">foo</span><span style="color: rgb(229, 229, 229)"> = 1;
               │         </span><span style="color: rgb(13, 188, 121)">~~~</span><span style="color: rgb(229, 229, 229)">
               ╵         </span><span style="color: rgb(13, 188, 121)">;</span>
    `);
  });
});
