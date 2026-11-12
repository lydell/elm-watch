import { describe, expect, test } from "vitest";

import { printStdio } from "../src/Errors.ts";
import { escapeHtml } from "../src/Helpers.ts";

function toHtml(stdout: string, stderr: string): string {
  return printStdio(stdout, stderr)(80, (piece) => escapeHtml(piece.text));
}

describe("printStdio", () => {
  test("escapes HTML and removes escape codes, but keeps indentation", () => {
    expect(
      toHtml("", "\x1B[31m<img src=x>\x1B[0m\x1B[2J\n    indented\n"),
    ).toBe("&lt;img src=x&gt;\n    indented");
  });

  test("empty lines count towards the limit", () => {
    const output = toHtml(`${"\n".repeat(1000)}text`, "");
    expect(output.split("\n")).toHaveLength(101);
    expect(output.endsWith("901 more lines")).toBe(true);
  });
});
