import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";

// Errors are shown one at a time, and you navigate between them with the
// keyboard. Errors are grouped by target, and within a target by file. This is
// shared by the terminal and the browser, which render errors differently, so
// it only cares about error IDs and locations. In the browser, the errors of
// all targets on the page are put together in one group.

type Location<File extends string = string> =
  | { tag: "FileOnly"; file: File }
  | { tag: "FileWithLineAndColumn"; file: File; line: number; column: number }
  | { tag: "Target" };

export type ErrorGroup<E extends ErrorGroupError> = {
  targetName: string;
  files: Array<ErrorGroupFile<E>>;
  numErrors: number;
};

type ErrorGroupFile<E extends ErrorGroupError> = {
  // The empty string for errors without a file.
  file: string;
  errors: NonEmptyArray<E>;
};

export type ErrorGroupError = {
  // The full error message. Used to identify the error between compilations.
  id: string;
  location: Location | undefined;
};

export type Selection = {
  targetName: string;
  // The files of the selected target, and the errors of the selected file, as
  // of the last render. Used to figure out which error to select after
  // recompiling.
  files: Array<string>;
  fileIndex: number;
  errors: Array<string>;
  errorIndex: number;
};

export type NavigationKey =
  | "NextError"
  | "PreviousError"
  | "NextFile"
  | "PreviousFile"
  | "NextTarget"
  | "PreviousTarget";

// Groups by file (in order of appearance), sorts by line and column within
// each file, and removes duplicates.
export function makeErrorGroup<E extends ErrorGroupError>(
  targetName: string,
  errors: Array<E>,
): ErrorGroup<E> {
  const seen = new Set<string>();
  const byFile = new Map<
    string,
    Array<{ error: E; line: number; column: number }>
  >();

  for (const error of errors) {
    if (seen.has(error.id)) {
      continue;
    }
    seen.add(error.id);
    const { location } = error;
    const { file, line, column } =
      location === undefined || location.tag === "Target"
        ? { file: "", line: 0, column: 0 }
        : location.tag === "FileOnly"
          ? { file: location.file, line: 0, column: 0 }
          : location;
    const fileErrors = byFile.get(file) ?? [];
    fileErrors.push({ error, line, column });
    byFile.set(file, fileErrors);
  }

  const files = Array.from(byFile, ([file, fileErrors]): ErrorGroupFile<E> => {
    const sorted = [...fileErrors]
      .sort((a, b) =>
        a.line === b.line ? a.column - b.column : a.line - b.line,
      )
      .map(({ error }) => error);
    return { file, errors: sorted as NonEmptyArray<E> };
  });

  return { targetName, files, numErrors: seen.size };
}

function select<E extends ErrorGroupError>(
  target: ErrorGroup<E>,
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
export function reconcile<E extends ErrorGroupError>(
  selection: Selection | undefined,
  targets: Array<ErrorGroup<E>>,
  priorities: Map<string, number>,
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
export function navigate<E extends ErrorGroupError>(
  selection: Selection,
  targets: Array<ErrorGroup<E>>,
  key: NavigationKey,
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

// Whether tab does anything. Only then is the selected target highlighted:
// Otherwise there’s nothing to choose between, and the highlight would just be
// confusing.
export function canSwitchTarget<E extends ErrorGroupError>(
  selection: Selection,
  targets: Array<ErrorGroup<E>>,
): boolean {
  return targets.some(
    (target) =>
      target.targetName !== selection.targetName && target.numErrors > 0,
  );
}

export function getSelectedTarget<E extends ErrorGroupError>(
  selection: Selection,
  targets: Array<ErrorGroup<E>>,
): ErrorGroup<E> | undefined {
  return targets.find((target) => target.targetName === selection.targetName);
}

export function getSelectedError<E extends ErrorGroupError>(
  selection: Selection,
  targets: Array<ErrorGroup<E>>,
): E | undefined {
  return getSelectedTarget(selection, targets)?.files[selection.fileIndex]
    ?.errors[selection.errorIndex];
}

// 1-based, counting across files.
export function getErrorNumber<E extends ErrorGroupError>(
  selection: Selection,
  target: ErrorGroup<E>,
): number {
  return (
    target.files
      .slice(0, selection.fileIndex)
      .reduce((sum, file) => sum + file.errors.length, 0) +
    selection.errorIndex +
    1
  );
}

export function getOpenEditorLocation<File extends string>(
  location: Location<File> | undefined,
): { file: File; line: number; column: number } | undefined {
  switch (location?.tag) {
    case undefined:
    case "Target":
      return undefined;
    case "FileOnly":
      return { file: location.file, line: 1, column: 1 };
    case "FileWithLineAndColumn":
      return {
        file: location.file,
        line: location.line,
        column: location.column,
      };
  }
}
