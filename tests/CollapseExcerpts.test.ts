import { describe, expect, test } from "vitest";

import { collapseExcerpts, linesToKeep } from "../src/CollapseExcerpts.ts";
import type { MessageChunk } from "../src/ElmMakeError.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

function red(string: string): MessageChunk {
  return { bold: false, underline: false, color: "RED", string };
}

// Turns an Elm error message as printed in the terminal into chunks like in
// `elm make --report=json`: The `>` markers and `^` underlines are red.
function toChunks(message: string): Array<MessageChunk> {
  return message.split("\n").flatMap((line, index): Array<MessageChunk> => {
    const newline = index === 0 ? [] : ["\n"];
    const marked = /^( *\d+\|)>(.*)$/.exec(line);
    if (marked !== null) {
      return [...newline, marked[1] ?? "", red(">"), marked[2] ?? ""];
    }
    const caret = /^( +)(\^+)$/.exec(line);
    if (caret !== null) {
      return [...newline, caret[1] ?? "", red(caret[2] ?? "")];
    }
    return [...newline, line];
  });
}

function collapse(message: string): string {
  const result = collapseExcerpts(toChunks(message));
  return result === undefined
    ? "(nothing to collapse)"
    : result
        .map((chunk) =>
          typeof chunk === "string"
            ? chunk
            : "tag" in chunk
              ? chunk.text
              : chunk.string,
        )
        .join("");
}

function codeLines(
  from: number,
  to: number,
  { marked = false }: { marked?: boolean } = {},
): string {
  const width = String(to).length;
  return Array.from({ length: to - from + 1 }, (_, index) => {
    const n = from + index;
    return `${String(n).padStart(width)}|${marked ? ">" : " "}    line${n}`;
  }).join("\n");
}

describe("collapseExcerpts", () => {
  test("short excerpts are left alone", () => {
    expect(
      collapse(`
Something is off:

${codeLines(5, 14, { marked: true })}

The end.
`),
    ).toMatchInlineSnapshot(`(nothing to collapse)`);
  });

  test("hiding just a few lines isn’t worth it", () => {
    expect(
      collapse(`
Something is off:

${codeLines(5, 16, { marked: true })}

The end.
`),
    ).toMatchInlineSnapshot(`(nothing to collapse)`);
  });

  test("long case expression: missing patterns (everything marked)", () => {
    expect(
      collapse(`This \`case\` does not have branches for all possibilities:

 38|>    case t of
 39|>        C1 ->
 40|>            "c1"
 41|>
 42|>        C2 ->
 43|>            "c2"
 44|>
 45|>        C3 ->
 46|>            "c3"
 47|>
 48|>        C4 ->
 49|>            "c4"
 50|>
 51|>        C5 ->
 52|>            "c5"
 53|>
 54|>        C6 ->
 55|>            "c6"
 56|>
 57|>        C7 ->
 58|>            "c7"

Missing possibilities include:

    C8
    C9`),
    ).toMatchInlineSnapshot(`
      This \`case\` does not have branches for all possibilities:

       38|>    case t of
       39|>        C1 ->
       40|>            "c1"
       41|>
       42|>        C2 ->
       43|>            "c2"
         ⋮ (12 lines)
       56|>
       57|>        C7 ->
       58|>            "c7"

      Missing possibilities include:

          C8
          C9
    `);
  });

  test("syntax error at the end of a long case expression (caret)", () => {
    expect(
      collapse(`I am partway through parsing a \`case\` expression, but I got stuck here:

 4|     case x of
 5|         1 ->
 6|             "c1"
 7|
 8|         2 ->
 9|             "c2"
10|
11|         3 ->
12|             "c3"
13|
14|         4 ->
15|             "c4"
16|
17|         5 ->
18|             "c5"
19|
20|         6 -> =
                  ^
I was expecting to see an expression like 42 or "hello".`),
    ).toMatchInlineSnapshot(`
      I am partway through parsing a \`case\` expression, but I got stuck here:

       4|     case x of
        ⋮ (8 lines)
      13|
      14|         4 ->
      15|             "c4"
      16|
      17|         5 ->
      18|             "c5"
      19|
      20|         6 -> =
                        ^
      I was expecting to see an expression like 42 or "hello".
    `);
  });

  test("one marked line in the middle of a long list", () => {
    expect(
      collapse(`The 10th element of this list does not match all the previous elements:

 9|         [ text "1"
10|         , text "2"
11|         , text "3"
12|         , text "4"
13|         , text "5"
14|         , text "6"
15|         , text "7"
16|         , text "8"
17|         , text "9"
18|>        , "10"
19|         , text "11"
20|         , text "12"
21|         , text "13"
22|         , text "14"
23|         , text "15"
24|         , text "16"
25|         ]

The 10th element is a string of type:`),
    ).toMatchInlineSnapshot(`
      The 10th element of this list does not match all the previous elements:

       9|         [ text "1"
        ⋮ (3 lines)
      13|         , text "5"
      14|         , text "6"
      15|         , text "7"
      16|         , text "8"
      17|         , text "9"
      18|>        , "10"
      19|         , text "11"
      20|         , text "12"
        ⋮ (5 lines)

      The 10th element is a string of type:
    `);
  });

  test("several excerpts in one message are collapsed separately", () => {
    expect(
      collapse(`First:

${codeLines(1, 20, { marked: true })}

Second:

${codeLines(101, 103)}
             ^^

Third:

${codeLines(201, 220)}
             ^^
The end.`),
    ).toMatchInlineSnapshot(`
      First:

       1|>    line1
       2|>    line2
       3|>    line3
       4|>    line4
       5|>    line5
       6|>    line6
        ⋮ (11 lines)
      18|>    line18
      19|>    line19
      20|>    line20

      Second:

      101|     line101
      102|     line102
      103|     line103
                   ^^

      Third:

      201|     line201
         ⋮ (11 lines)
      213|     line213
      214|     line214
      215|     line215
      216|     line216
      217|     line217
      218|     line218
      219|     line219
      220|     line220
                   ^^
      The end.
    `);
  });

  test("styles are kept", () => {
    const message = toChunks(`Hello:

${codeLines(1, 20, { marked: true })}`);
    expect(collapseExcerpts(message)?.slice(0, 6)).toStrictEqual([
      "Hello:",
      "\n",
      "\n",
      " 1|",
      red(">"),
      "    line1",
    ]);
  });

  test("no excerpts", () => {
    expect(collapse("Just some text.\n\n    1 | 2")).toMatchInlineSnapshot(
      `(nothing to collapse)`,
    );
  });
});

describe("linesToKeep", () => {
  function show(numLines: number, first: number, last: number = first): string {
    return linesToKeep(numLines, { first, last })
      .map((keep, index) =>
        index >= first && index <= last ? (keep ? "M" : "m") : keep ? "x" : ".",
      )
      .join("");
  }

  test("everything fits", () => {
    expect(show(12, 3)).toMatchInlineSnapshot(`xxxMxxxxxxxx`);
  });

  test("relevant line at the start", () => {
    expect(show(30, 0)).toMatchInlineSnapshot(`Mxxxxxxxx.....................`);
  });

  test("relevant line at the end", () => {
    expect(show(30, 29)).toMatchInlineSnapshot(
      `x.....................xxxxxxxM`,
    );
  });

  test("relevant line in the middle: more context above than below", () => {
    expect(show(30, 15)).toMatchInlineSnapshot(
      `x.........xxxxxMxx............`,
    );
  });

  test("relevant lines are too many: start and end", () => {
    expect(show(30, 2, 25)).toMatchInlineSnapshot(
      `xxMMMMMMmmmmmmmmmmmmmmmMMM....`,
    );
  });

  test("everything relevant", () => {
    expect(show(30, 0, 29)).toMatchInlineSnapshot(
      `MMMMMMmmmmmmmmmmmmmmmmmmmmmMMM`,
    );
  });

  test("short hidden runs are shown", () => {
    expect(show(30, 8)).toMatchInlineSnapshot(`xxxxxxxxMxx...................`);
  });
});
