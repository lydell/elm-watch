import type { MessageChunk } from "./ElmMakeError.ts";

// Elm errors can contain very long code excerpts, such as a whole `case`
// expression with 50 branches. Those make it hard to see the error at a
// glance, so we collapse them, keeping the most relevant lines.
//
// Elm marks the relevant lines of an excerpt in one of two ways:
//
// - A red `>` after the line number on each relevant line: `18|>`.
// - A red `^^^` line below the last line, when only that line is relevant.
//
// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Render/Code.hs
//
// Note that the region of the problem is not always the same as the marked
// lines. For `{ a = 1, ... }.x`, the region is the whole record, while only the
// last line is marked.

// Roughly how many code lines to show, at most.
export const MAX_LINES = 10;

// When the relevant lines themselves are too many, show their start and this
// many lines at their end. For a `case` expression, the end is where you’d add
// missing branches.
const TAIL_LINES = 3;

// Hiding fewer lines than this isn’t worth it: The “lines hidden” line takes up
// a line itself.
const MIN_HIDDEN_LINES = 3;

export type Elision = {
  tag: "Elision";
  text: string;
};

// Returns `undefined` if there is nothing to collapse.
export function collapseExcerpts(
  message: Array<MessageChunk>,
): Array<Elision | MessageChunk> | undefined {
  const lines = splitLines(message);
  const result: Array<Array<Elision | MessageChunk>> = [];
  let collapsedAny = false;

  for (let index = 0; index < lines.length;) {
    if (!isCodeLine(lines[index] ?? [])) {
      result.push(lines[index] ?? []);
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && isCodeLine(lines[index] ?? [])) {
      index++;
    }
    const code = lines.slice(start, index);
    const hasCaretLine =
      index < lines.length && isCaretLine(lines[index] ?? []);
    const marked = code.flatMap((line, lineIndex) =>
      isMarkedLine(line) ? [lineIndex] : [],
    );
    const keep = linesToKeep(
      code.length,
      hasCaretLine
        ? { first: code.length - 1, last: code.length - 1 }
        : {
            first: marked[0] ?? 0,
            last: marked[marked.length - 1] ?? code.length - 1,
          },
    );
    const gutterWidth = plainText(code[code.length - 1] ?? []).indexOf("|");
    for (let lineIndex = 0; lineIndex < code.length;) {
      if (keep[lineIndex] === true) {
        result.push(code[lineIndex] ?? []);
        lineIndex++;
        continue;
      }
      const hiddenStart = lineIndex;
      while (lineIndex < code.length && keep[lineIndex] !== true) {
        lineIndex++;
      }
      collapsedAny = true;
      result.push([
        {
          tag: "Elision",
          text: `${" ".repeat(gutterWidth)}⋮ (${lineIndex - hiddenStart} lines)`,
        },
      ]);
    }
  }

  return collapsedAny
    ? result.flatMap((line, index) => (index === 0 ? line : ["\n", ...line]))
    : undefined;
}

// Which lines of an excerpt to show, given the range of relevant lines:
//
// - The first line, which is the start of the expression (such as `case x of`).
// - The relevant lines, with some context around them (preferably above, since
//   that’s what leads up to the relevant lines, especially for syntax errors).
// - If the relevant lines are too many: Their start and end.
export function linesToKeep(
  numLines: number,
  relevant: { first: number; last: number },
): Array<boolean> {
  const keep = Array.from({ length: numLines }, () => false);
  if (numLines < MAX_LINES + MIN_HIDDEN_LINES) {
    return keep.fill(true);
  }

  keep[0] = true;
  const { first, last } = relevant;

  if (last - first + 1 > MAX_LINES - 1) {
    // Make room for the line with the number of hidden lines.
    const head = MAX_LINES - 1 - TAIL_LINES;
    keep.fill(true, first, first + head);
    keep.fill(true, last - TAIL_LINES + 1, last + 1);
  } else {
    let start = first;
    let end = last;
    // Count the first line if it is not part of the window, as well as the
    // line with the number of hidden lines.
    const numShown = (): number => end - start + 1 + (start > 1 ? 1 : 0);
    for (let turn = 0; numShown() < MAX_LINES - 1; turn++) {
      // Two lines above for each line below.
      const preferAbove = turn % 3 !== 2;
      if (start > 0 && (preferAbove || end === numLines - 1)) {
        start--;
      } else if (end < numLines - 1) {
        end++;
      } else {
        break;
      }
    }
    keep.fill(true, start, end + 1);
  }

  // Show short runs of hidden lines after all.
  for (let index = 0; index < numLines;) {
    if (keep[index] === true) {
      index++;
      continue;
    }
    const hiddenStart = index;
    while (index < numLines && keep[index] !== true) {
      index++;
    }
    if (index - hiddenStart < MIN_HIDDEN_LINES) {
      keep.fill(true, hiddenStart, index);
    }
  }

  return keep;
}

function splitLines(message: Array<MessageChunk>): Array<Array<MessageChunk>> {
  const lines: Array<Array<MessageChunk>> = [[]];
  for (const chunk of message) {
    const text = typeof chunk === "string" ? chunk : chunk.string;
    text.split("\n").forEach((part, index) => {
      if (index > 0) {
        lines.push([]);
      }
      if (part !== "") {
        lines[lines.length - 1]?.push(
          typeof chunk === "string" ? part : { ...chunk, string: part },
        );
      }
    });
  }
  return lines;
}

function plainText(line: Array<MessageChunk>): string {
  return line
    .map((chunk) => (typeof chunk === "string" ? chunk : chunk.string))
    .join("");
}

// Elm puts a `>` or a space after the `|`.
function isCodeLine(line: Array<MessageChunk>): boolean {
  return /^ *\d+\|/.test(plainText(line));
}

function isMarkedLine(line: Array<MessageChunk>): boolean {
  return /^ *\d+\|>/.test(plainText(line));
}

// There can be two groups of `^`, when Elm shows two regions on the same line.
function isCaretLine(line: Array<MessageChunk>): boolean {
  return /^ *\^[ ^]*$/.test(plainText(line));
}
