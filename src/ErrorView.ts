import * as Errors from "./Errors.ts";
import {
  canSwitchTarget,
  type ErrorGroup,
  getErrorNumber,
  getOpenEditorLocation,
  getSelectedError,
  getSelectedTarget,
  makeErrorGroup,
  type NavigationKey,
  type Selection,
} from "./ErrorSelection.ts";
import { bold, dim, removeColor } from "./Helpers.ts";
import type { LoggerConfig } from "./Logger.ts";
import type { TargetName } from "./Types.ts";

// In the terminal, errors are shown one at a time, and you navigate between
// them with the keyboard. See ErrorSelection.ts for which error is selected.

export type ErrorViewTarget = ErrorGroup<ErrorViewError>;

type ErrorViewError = {
  id: string;
  template: Errors.ErrorTemplate;
  location: Errors.ErrorLocation | undefined;
};

export type ErrorViewState = {
  showAll: boolean;
  // Long code excerpts are collapsed by default. See CollapseExcerpts.ts.
  expanded: boolean;
  selection: Selection | undefined;
};

export type ErrorViewKey =
  | NavigationKey
  | "OpenEditor"
  | "ToggleExpanded"
  | "ToggleShowAll";

const KEYS: Array<[string, ErrorViewKey]> = [
  ["\x1B[C", "NextError"],
  ["l", "NextError"],
  ["\x1B[D", "PreviousError"],
  ["h", "PreviousError"],
  ["\x1B[B", "NextFile"],
  ["j", "NextFile"],
  ["\x1B[A", "PreviousFile"],
  ["k", "PreviousFile"],
  ["\t", "NextTarget"],
  ["\x1B[Z", "PreviousTarget"],
  ["\r", "OpenEditor"],
  ["o", "OpenEditor"],
  [" ", "ToggleExpanded"],
  ["a", "ToggleShowAll"],
];

// Several keys can arrive in one chunk if typed quickly. If anything in the
// chunk is unknown (such as a response to a terminal query), ignore it all.
export function parseKeys(data: string): Array<ErrorViewKey> {
  const keys: Array<ErrorViewKey> = [];
  let rest = data;
  while (rest !== "") {
    const match = KEYS.find(([sequence]) => rest.startsWith(sequence));
    if (match === undefined) {
      return [];
    }
    const [sequence, key] = match;
    keys.push(key);
    rest = rest.slice(sequence.length);
  }
  return keys;
}

export function makeErrorViewTarget(
  targetName: TargetName,
  templates: Array<Errors.ErrorTemplate>,
): ErrorViewTarget {
  return makeErrorGroup(
    targetName,
    templates.map((template) => ({
      id: Errors.toPlainString(template),
      template,
      location: Errors.getErrorLocation(template),
    })),
  );
}

// Everything below the status lines and server line: The selected error, the
// info message line, where you are and which keys to press. The keys are last,
// so they are right next to the cursor and easy to find. Only the error area
// changes when switching to showing all errors (see `renderShowAll`).
export function render({
  loggerConfig,
  expanded,
  selection,
  targets,
  notice,
  infoLine,
}: {
  loggerConfig: LoggerConfig;
  expanded: boolean;
  selection: Selection;
  targets: Array<ErrorViewTarget>;
  notice: string | undefined;
  infoLine: string | undefined;
}): string {
  const target = getSelectedTarget(selection, targets);
  const hasOtherTargetsWithErrors = canSwitchTarget(selection, targets);
  const error = getSelectedError(selection, targets);
  const noticeLines = notice === undefined ? [] : [notice, ""];
  const infoLines = infoLine === undefined ? [] : [infoLine];

  if (target === undefined || error === undefined) {
    return [
      ...noticeLines,
      ...infoLines,
      `${loggerConfig.fancy ? "✅ " : ""}${bold(selection.targetName)} has no errors.`,
      "",
      keyHints(loggerConfig.columns, [
        hasOtherTargetsWithErrors
          ? ["tab", "next target with errors"]
          : undefined,
        ["a", "show all"],
      ]),
    ].join("\n");
  }

  const errorNumber = getErrorNumber(selection, target);

  const position = [
    `error ${errorNumber}/${target.numErrors}`,
    target.files.length > 1
      ? `file ${selection.fileIndex + 1}/${target.files.length}`
      : undefined,
  ]
    .flatMap((part) => part ?? [])
    .join("   ");

  return [
    Errors.toTerminalString(
      error.template,
      loggerConfig.columns,
      loggerConfig.noColor,
      !expanded,
    ),
    "",
    ...noticeLines,
    ...infoLines,
    `${loggerConfig.fancy ? "🚨 " : ""}${position}`,
    "",
    keyHints(loggerConfig.columns, [
      [
        [
          ["←", errorNumber > 1],
          ["→", errorNumber < target.numErrors],
        ],
        "error",
      ],
      [
        [
          ["↑", selection.fileIndex > 0],
          ["↓", selection.fileIndex + 1 < target.files.length],
        ],
        "file",
      ],
      hasOtherTargetsWithErrors ? ["tab", "target"] : undefined,
      getOpenEditorLocation(error.location) === undefined
        ? undefined
        : ["enter", "open in editor"],
      Errors.isCollapsible(error.template)
        ? ["space", expanded ? "collapse" : "expand"]
        : undefined,
      ["a", "show all"],
    ]),
  ].join("\n");
}

// Like `render`, but with all errors (of all targets).
export function renderShowAll({
  loggerConfig,
  errorStrings,
  infoLine,
}: {
  loggerConfig: LoggerConfig;
  errorStrings: Array<string>;
  infoLine: string | undefined;
}): string {
  const numErrors = errorStrings.length;
  return [
    ...(numErrors === 0 ? [] : [errorStrings.join("\n\n"), ""]),
    ...(infoLine === undefined ? [] : [infoLine]),
    `${loggerConfig.fancy ? "🚨 " : ""}${numErrors} error${numErrors === 1 ? "" : "s"}`,
    "",
    keyHints(loggerConfig.columns, [["a", "show one error at a time"]]),
  ].join("\n");
}

// A key, or several keys with whether each of them does anything right now.
type HintKeys = string | Array<[key: string, enabled: boolean]>;

// Styled like in run-pty: [key] label
// Keys that don’t do anything right now are dimmed (and the label too, if none
// of the keys do anything).
// If the hints don’t fit on one line, they wrap between hints rather than in
// the middle of one.
function keyHints(
  columns: number,
  hints: Array<[keys: HintKeys, label: string] | undefined>,
): string {
  const separator = "   ";
  const lines: Array<string> = [];
  let line = "";
  let lineWidth = 0;
  for (const hint of renderKeyHints(hints)) {
    const width = Array.from(removeColor(hint)).length;
    if (line === "") {
      line = hint;
      lineWidth = width;
    } else if (lineWidth + separator.length + width <= columns) {
      line += separator + hint;
      lineWidth += separator.length + width;
    } else {
      lines.push(line);
      line = hint;
      lineWidth = width;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

function renderKeyHints(
  hints: Array<[keys: HintKeys, label: string] | undefined>,
): Array<string> {
  return hints.flatMap((hint) => {
    if (hint === undefined) {
      return [];
    }
    const [keys, label] = hint;
    const keysArray: Array<[string, boolean]> =
      typeof keys === "string" ? [[keys, true]] : keys;
    const styledKeys = keysArray
      .map(([key, enabled]) => (enabled ? bold(key) : dim(key)))
      .join("");
    const anyEnabled = keysArray.some(([, enabled]) => enabled);
    return [
      `${dim("[")}${styledKeys}${dim("]")} ${anyEnabled ? label : dim(label)}`,
    ];
  });
}
