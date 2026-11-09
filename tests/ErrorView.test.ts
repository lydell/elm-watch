import { describe, expect, test } from "vitest";

import type { ErrorTemplate } from "../src/Errors.ts";
import {
  type ErrorViewTarget,
  makeErrorViewTarget,
  navigate,
  parseKeys,
  reconcile,
  type Selection,
} from "../src/ErrorView.ts";
import {
  markAsAbsolutePath,
  markAsTargetName,
  type TargetName,
} from "../src/Types.ts";

// "File.elm:3:message" creates an error in File.elm on line 3.
function error(spec: string): ErrorTemplate {
  const [file = "", line = "1", message = ""] = spec.split(":");
  return () => ({
    title: "ERROR",
    location: {
      tag: "FileWithLineAndColumn",
      file: markAsAbsolutePath(`/${file}`),
      line: Number(line),
      column: 1,
    },
    content: message,
  });
}

function target(name: string, specs: Array<string>): ErrorViewTarget {
  return makeErrorViewTarget(markAsTargetName(name), specs.map(error));
}

// Prints the selected error as "File.elm:3:message".
function show(
  selection: Selection | undefined,
  targets: Array<ErrorViewTarget>,
): string {
  if (selection === undefined) {
    return "(nothing)";
  }
  const file = selection.files[selection.fileIndex];
  const errorId = selection.errors[selection.errorIndex];
  if (file === undefined || errorId === undefined) {
    return `${selection.targetName}: (no errors)`;
  }
  const t = targets.find((t2) => t2.targetName === selection.targetName);
  const index = t?.files[selection.fileIndex]?.errors.findIndex(
    (e) => e.id === errorId,
  );
  const location = t?.files[selection.fileIndex]?.errors[index ?? -1]
    ?.location as { line: number } | undefined;
  const message = errorId.split("\n").at(-1) ?? "";
  return `${selection.targetName}: ${file.slice(1)}:${location?.line ?? "?"}:${message}`;
}

const noPriorities = new Map<TargetName, number>();

function start(targets: Array<ErrorViewTarget>): Selection {
  const selection = reconcile(undefined, targets, noPriorities);
  if (selection === undefined) {
    throw new Error("Expected a selection");
  }
  return selection;
}

describe("parseKeys", () => {
  test("single keys", () => {
    expect(parseKeys("\x1B[C")).toEqual(["NextError"]);
    expect(parseKeys("j")).toEqual(["NextFile"]);
    expect(parseKeys("\x1B[Z")).toEqual(["PreviousTarget"]);
    expect(parseKeys("\r")).toEqual(["OpenEditor"]);
  });

  test("several keys in one chunk", () => {
    expect(parseKeys("ll\x1B[B")).toEqual([
      "NextError",
      "NextError",
      "NextFile",
    ]);
  });

  test("unknown input is ignored entirely", () => {
    expect(parseKeys("x")).toEqual([]);
    expect(parseKeys("l\x1B]11;rgb:aaaa/bbbb/cccc\x1B\\")).toEqual([]);
  });
});

describe("makeErrorViewTarget", () => {
  test("groups by file in order of appearance, sorts by line, deduplicates", () => {
    const t = target("Main", [
      "B.elm:5:b5",
      "A.elm:9:a9",
      "B.elm:2:b2",
      "A.elm:9:a9",
    ]);
    expect(t.numErrors).toBe(3);
    expect(t.files.map((file) => file.file)).toEqual(["/B.elm", "/A.elm"]);
    expect(t.files[0]?.errors.map((e) => e.id.split("\n").at(-1))).toEqual([
      "b2",
      "b5",
    ]);
  });
});

describe("reconcile", () => {
  test("nothing selected when there are no errors", () => {
    expect(reconcile(undefined, [target("Main", [])], noPriorities)).toBe(
      undefined,
    );
  });

  test("starts at the first target with errors, preferring priority", () => {
    const targets = [
      target("A", []),
      target("B", ["X.elm:1:b"]),
      target("C", ["X.elm:1:c"]),
    ];
    expect(show(start(targets), targets)).toBe("B: X.elm:1:b");
    const priorities = new Map([[markAsTargetName("C"), 5]]);
    expect(show(reconcile(undefined, targets, priorities), targets)).toBe(
      "C: X.elm:1:c",
    );
  });

  test("keeps the selected error if it still exists", () => {
    const before = [target("Main", ["A.elm:1:one", "A.elm:2:two"])];
    const selection = navigate(start(before), before, "NextError");
    const after = [target("Main", ["A.elm:2:two"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:2:two",
    );
  });

  test("fixing the selected error goes to the next one", () => {
    const before = [
      target("Main", ["A.elm:1:one", "A.elm:2:two", "A.elm:3:three"]),
    ];
    const selection = navigate(start(before), before, "NextError");
    const after = [target("Main", ["A.elm:1:one", "A.elm:3:three"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:3:three",
    );
  });

  test("changing the selected error selects the changed error", () => {
    const before = [
      target("Main", ["A.elm:1:one", "A.elm:2:two", "A.elm:3:three"]),
    ];
    const selection = navigate(start(before), before, "NextError");
    const after = [
      target("Main", ["A.elm:1:one", "A.elm:2:changed", "A.elm:3:three"]),
    ];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:2:changed",
    );
  });

  test("lines moving below skipped errors keeps your place", () => {
    const before = [
      target("Main", ["A.elm:1:one", "A.elm:2:two", "A.elm:3:three"]),
    ];
    const selection = navigate(start(before), before, "NextError");
    // Edited line 2 so that it now spans two lines, still the same error but
    // at a new line (and a new message, since the line number is in it).
    const after = [
      target("Main", ["A.elm:1:one", "A.elm:3:two", "A.elm:4:three"]),
    ];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:3:two",
    );
  });

  test("fixing the last error in a file goes to the next file", () => {
    const before = [target("Main", ["A.elm:1:a1", "A.elm:2:a2", "B.elm:1:b1"])];
    const selection = navigate(start(before), before, "NextError");
    const after = [target("Main", ["A.elm:1:a1", "B.elm:1:b1"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: B.elm:1:b1",
    );
  });

  test("fixing the last error of the last file goes to the previous error", () => {
    const before = [target("Main", ["A.elm:1:a1", "A.elm:2:a2"])];
    const selection = navigate(start(before), before, "NextError");
    const after = [target("Main", ["A.elm:1:a1"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:1:a1",
    );
  });

  test("fixing all errors in a file goes to the next file", () => {
    const before = [
      target("Main", ["A.elm:1:a", "B.elm:1:b", "C.elm:1:c", "D.elm:1:d"]),
    ];
    const selection = navigate(start(before), before, "NextFile");
    const after = [target("Main", ["A.elm:1:a", "C.elm:1:c", "D.elm:1:d"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: C.elm:1:c",
    );
  });

  test("fixing all errors in the last file goes to the last file", () => {
    const before = [target("Main", ["A.elm:1:a", "B.elm:1:b"])];
    const selection = navigate(start(before), before, "NextFile");
    const after = [target("Main", ["A.elm:1:a"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "Main: A.elm:1:a",
    );
  });

  test("stays on a target without errors", () => {
    const before = [target("A", ["X.elm:1:a"]), target("B", ["X.elm:1:b"])];
    const selection = start(before);
    const after = [target("A", []), target("B", ["X.elm:1:b"])];
    expect(show(reconcile(selection, after, noPriorities), after)).toBe(
      "A: (no errors)",
    );
  });
});

describe("navigate", () => {
  const targets = [
    target("A", ["X.elm:1:a1", "X.elm:2:a2", "Y.elm:1:a3"]),
    target("B", []),
    target("C", ["X.elm:1:c1"]),
  ];

  test("errors cross file boundaries, and stop at the ends", () => {
    let selection = start(targets);
    const visited = [show(selection, targets)];
    for (let i = 0; i < 3; i++) {
      selection = navigate(selection, targets, "NextError");
      visited.push(show(selection, targets));
    }
    selection = navigate(selection, targets, "PreviousError");
    visited.push(show(selection, targets));
    expect(visited).toEqual([
      "A: X.elm:1:a1",
      "A: X.elm:2:a2",
      "A: Y.elm:1:a3",
      "A: Y.elm:1:a3",
      "A: X.elm:2:a2",
    ]);
  });

  test("files", () => {
    let selection = navigate(start(targets), targets, "NextError");
    selection = navigate(selection, targets, "NextFile");
    expect(show(selection, targets)).toBe("A: Y.elm:1:a3");
    selection = navigate(selection, targets, "PreviousFile");
    expect(show(selection, targets)).toBe("A: X.elm:1:a1");
  });

  test("targets skip targets without errors and wrap around", () => {
    let selection = navigate(start(targets), targets, "NextTarget");
    expect(show(selection, targets)).toBe("C: X.elm:1:c1");
    selection = navigate(selection, targets, "NextTarget");
    expect(show(selection, targets)).toBe("A: X.elm:1:a1");
    selection = navigate(selection, targets, "PreviousTarget");
    expect(show(selection, targets)).toBe("C: X.elm:1:c1");
  });
});
