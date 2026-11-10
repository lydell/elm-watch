import { describe, expect, test } from "vitest";

import { markAsTargetName, type TargetName } from "../src/Types.ts";
import { makePrioritizedOutputs } from "../src/WebSocketConnect.ts";
import { makeProject } from "./ProjectHelpers.ts";

// `makePrioritizedOutputs` decides which outputs are fully compiled (not just
// typechecked), and in which order, based on the connected web sockets and the
// waiting output requests.

const project = makeProject({
  elmJsons: {
    app: [
      ["One", "clean"],
      ["Two", "clean"],
      ["Three", "clean"],
    ],
  },
});

function connection(
  params: Record<string, string>,
  priority: number,
): { urlParams: URLSearchParams; priority: number } {
  return {
    urlParams: new URLSearchParams({
      webSocketToken: "token",
      elmCompiledTimestamp: "0",
      ...params,
    }),
    priority,
  };
}

function outputRequest(
  targetName: string,
  priority: number,
): { targetName: TargetName; priority: number } {
  return { targetName: markAsTargetName(targetName), priority };
}

describe("makePrioritizedOutputs", () => {
  test("nothing connected or requested", () => {
    expect(makePrioritizedOutputs(project, [], [])).toStrictEqual(new Map());
  });

  test("web sockets and output requests, latest priority wins", () => {
    expect(
      Object.fromEntries(
        makePrioritizedOutputs(
          project,
          [
            connection({ targetName: "One" }, 1),
            connection({ targetName: "Two" }, 5),
            connection({ targetName: "One" }, 2),
          ],
          [outputRequest("One", 3), outputRequest("Two", 4)],
        ),
      ),
    ).toStrictEqual({ One: 3, Two: 5 });
  });

  test("web sockets for unknown targets or with bad parameters are ignored", () => {
    expect(
      Object.fromEntries(
        makePrioritizedOutputs(
          project,
          [
            connection({ targetName: "Nope" }, 1),
            connection({ targetName: "Two", elmCompiledTimestamp: "x" }, 2),
            connection({ targetName: "Three", elmWatchVersion: "0.0.0" }, 3),
          ],
          [],
        ),
      ),
    ).toStrictEqual({});
  });
});
