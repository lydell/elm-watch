import * as Errors from "./Errors.ts";
import { bold, dim } from "./Helpers.ts";
import type { LoggerConfig } from "./Logger.ts";
import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import type { AbsolutePath, TargetName } from "./Types.ts";

// In the terminal, errors are shown one at a time, and you navigate between
// them with the keyboard. Errors are grouped by target, and within a target by
// file.

export type ErrorViewTarget = {
  targetName: TargetName;
  files: Array<ErrorViewFile>;
  numErrors: number;
};

type ErrorViewFile = {
  // The empty string for errors without a file.
  file: string;
  errors: NonEmptyArray<ErrorViewError>;
};

type ErrorViewError = {
  // The full error message. Used to identify the error between compilations.
  id: string;
  template: Errors.ErrorTemplate;
  location: Errors.ErrorLocation | undefined;
};

export type ErrorViewState = {
  showAll: boolean;
  selection: Selection | undefined;
};

export type Selection = {
  targetName: TargetName;
  // The files of the selected target, and the errors of the selected file, as
  // of the last render. Used to figure out which error to select after
  // recompiling.
  files: Array<string>;
  fileIndex: number;
  errors: Array<string>;
  errorIndex: number;
};

export type ErrorViewKey =
  | "NextError"
  | "PreviousError"
  | "NextFile"
  | "PreviousFile"
  | "NextTarget"
  | "PreviousTarget"
  | "OpenEditor"
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
  const seen = new Set<string>();
  const byFile = new Map<
    string,
    Array<ErrorViewError & { line: number; column: number }>
  >();

  for (const template of templates) {
    const id = Errors.toPlainString(template);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const location = Errors.getErrorLocation(template);
    const { file, line, column } =
      location === undefined || location.tag === "Target"
        ? { file: "", line: 0, column: 0 }
        : location.tag === "FileOnly"
          ? { file: location.file, line: 0, column: 0 }
          : {
              file: location.file,
              line: location.line,
              column: location.column,
            };
    const errors = byFile.get(file) ?? [];
    errors.push({ id, template, location, line, column });
    byFile.set(file, errors);
  }

  const files = Array.from(byFile, ([file, errors]): ErrorViewFile => {
    const sorted = [...errors]
      .sort((a, b) =>
        a.line === b.line ? a.column - b.column : a.line - b.line,
      )
      .map(({ id, template, location }) => ({ id, template, location }));
    return { file, errors: sorted as NonEmptyArray<ErrorViewError> };
  });

  return { targetName, files, numErrors: seen.size };
}

function select(
  target: ErrorViewTarget,
  fileIndex: number,
  errorIndex: number,
): Selection {
  return {
    targetName: target.targetName,
    files: target.files.map((file) => file.file),
    fileIndex,
    errors: target.files[fileIndex]?.errors.map((error) => error.id) ?? [],
    errorIndex,
  };
}

function commonPrefixLength(a: Array<string>, b: Array<string>): number {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) {
    index++;
  }
  return index;
}

// Called after each compilation (and before each render): Figure out which
// error to select, trying to keep your place.
export function reconcile(
  selection: Selection | undefined,
  targets: Array<ErrorViewTarget>,
  priorities: Map<TargetName, number>,
): Selection | undefined {
  const targetsWithErrors = targets.filter((target) => target.numErrors > 0);

  if (!isNonEmptyArray(targetsWithErrors)) {
    return undefined;
  }

  const target =
    selection === undefined
      ? undefined
      : targets.find(
          (otherTarget) => otherTarget.targetName === selection.targetName,
        );

  if (selection === undefined || target === undefined) {
    // Prefer the target that was most recently focused in the browser, and
    // elm-watch.json order otherwise.
    const best = targetsWithErrors.reduce((bestSoFar, otherTarget) =>
      (priorities.get(otherTarget.targetName) ?? 0) >
      (priorities.get(bestSoFar.targetName) ?? 0)
        ? otherTarget
        : bestSoFar,
    );
    return select(best, 0, 0);
  }

  // Don’t move on to the next target automatically when the selected one has
  // no errors anymore. Instead we say so, and let you press tab.
  if (target.numErrors === 0) {
    return select(target, 0, 0);
  }

  const newFiles = target.files.map((file) => file.file);
  const oldFile = selection.files[selection.fileIndex];
  const fileIndex = oldFile === undefined ? -1 : newFiles.indexOf(oldFile);

  if (fileIndex === -1) {
    // The selected file has no errors anymore. Go to the first file that
    // differs from the files before it. Typically, that’s the next file.
    const index = commonPrefixLength(
      selection.files.slice(0, selection.fileIndex),
      newFiles,
    );
    return select(target, Math.min(index, newFiles.length - 1), 0);
  }

  const newErrors = target.files[fileIndex]?.errors.map((error) => error.id);
  if (newErrors === undefined) {
    return select(target, 0, 0);
  }

  const oldError = selection.errors[selection.errorIndex];
  const errorIndex = oldError === undefined ? -1 : newErrors.indexOf(oldError);
  if (errorIndex !== -1) {
    return select(target, fileIndex, errorIndex);
  }

  // The selected error is gone (fixed or changed). Go to the first error that
  // differs from the errors before it. Typically, that’s the next error (or
  // the changed error).
  const index = commonPrefixLength(
    selection.errors.slice(0, selection.errorIndex),
    newErrors,
  );
  return index < newErrors.length
    ? select(target, fileIndex, index)
    : fileIndex + 1 < newFiles.length
      ? select(target, fileIndex + 1, 0)
      : select(target, fileIndex, newErrors.length - 1);
}

// Assumes that `reconcile` has been run with the same targets.
export function navigate(
  selection: Selection,
  targets: Array<ErrorViewTarget>,
  key: Exclude<ErrorViewKey, "OpenEditor" | "ToggleShowAll">,
): Selection {
  const targetIndex = targets.findIndex(
    (target) => target.targetName === selection.targetName,
  );
  const target = targets[targetIndex];
  if (target === undefined) {
    return selection;
  }

  const { fileIndex, errorIndex } = selection;
  const numFiles = target.files.length;
  const numErrors = selection.errors.length;

  switch (key) {
    case "NextError":
      return errorIndex + 1 < numErrors
        ? select(target, fileIndex, errorIndex + 1)
        : fileIndex + 1 < numFiles
          ? select(target, fileIndex + 1, 0)
          : selection;

    case "PreviousError":
      return errorIndex > 0
        ? select(target, fileIndex, errorIndex - 1)
        : fileIndex > 0
          ? select(
              target,
              fileIndex - 1,
              (target.files[fileIndex - 1]?.errors.length ?? 1) - 1,
            )
          : selection;

    case "NextFile":
      return fileIndex + 1 < numFiles
        ? select(target, fileIndex + 1, 0)
        : selection;

    case "PreviousFile":
      return fileIndex > 0 ? select(target, fileIndex - 1, 0) : selection;

    case "NextTarget":
    case "PreviousTarget": {
      const step = key === "NextTarget" ? 1 : -1;
      for (let i = 1; i < targets.length; i++) {
        const otherTarget =
          targets[
            (((targetIndex + step * i) % targets.length) + targets.length) %
              targets.length
          ];
        if (otherTarget !== undefined && otherTarget.numErrors > 0) {
          return select(otherTarget, 0, 0);
        }
      }
      return selection;
    }
  }
}

export function getSelectedError(
  selection: Selection,
  targets: Array<ErrorViewTarget>,
): ErrorViewError | undefined {
  return targets.find((target) => target.targetName === selection.targetName)
    ?.files[selection.fileIndex]?.errors[selection.errorIndex];
}

export function getOpenEditorLocation(
  location: Errors.ErrorLocation | undefined,
): { file: AbsolutePath; line: number; column: number } | undefined {
  switch (location?.tag) {
    case undefined:
    case "Target":
      return undefined;
    case "FileOnly":
      return { file: location.file, line: 1, column: 1 };
    case "FileWithLineAndColumn":
      return location;
  }
}

// Everything below the status lines and server line: The selected error, the
// info message line, where you are and which keys to press. The keys are last,
// so they are right next to the cursor and easy to find. Only the error area
// changes when switching to showing all errors (see `renderShowAll`).
export function render({
  loggerConfig,
  selection,
  targets,
  notice,
  infoLine,
}: {
  loggerConfig: LoggerConfig;
  selection: Selection;
  targets: Array<ErrorViewTarget>;
  notice: string | undefined;
  infoLine: string | undefined;
}): string {
  const target = targets.find(
    (otherTarget) => otherTarget.targetName === selection.targetName,
  );
  const hasOtherTargetsWithErrors = targets.some(
    (otherTarget) =>
      otherTarget.targetName !== selection.targetName &&
      otherTarget.numErrors > 0,
  );
  const error = getSelectedError(selection, targets);
  const noticeLines = notice === undefined ? [] : [notice, ""];
  const infoLines = infoLine === undefined ? [] : [infoLine];

  if (target === undefined || error === undefined) {
    return [
      ...noticeLines,
      ...infoLines,
      `${loggerConfig.fancy ? "✅ " : ""}${bold(selection.targetName)} has no errors.`,
      keyHints([
        hasOtherTargetsWithErrors
          ? ["tab", "next target with errors"]
          : undefined,
        ["a", "show all"],
      ]),
    ].join("\n");
  }

  const errorNumber =
    target.files
      .slice(0, selection.fileIndex)
      .reduce((sum, file) => sum + file.errors.length, 0) +
    selection.errorIndex +
    1;

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
    ),
    "",
    ...noticeLines,
    ...infoLines,
    `${loggerConfig.fancy ? "🚨 " : ""}${position}`,
    keyHints([
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
    keyHints([["a", "show one error at a time"]]),
  ].join("\n");
}

// A key, or several keys with whether each of them does anything right now.
type HintKeys = string | Array<[key: string, enabled: boolean]>;

// Styled like in run-pty: [key] label
// Keys that don’t do anything right now are dimmed (and the label too, if none
// of the keys do anything).
function keyHints(
  hints: Array<[keys: HintKeys, label: string] | undefined>,
): string {
  return hints
    .flatMap((hint) => {
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
    })
    .join("   ");
}
