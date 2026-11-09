import { describe, expect, test } from "vitest";

import { getOutputActions, type OutputActions } from "../src/Compile.ts";
import { DEFAULT_HOST } from "../src/Host.ts";
import {
  type OutputStatus,
  OutputState,
  type PackageState,
  type PackageStatus,
  type Project,
  TargetState,
} from "../src/Project.ts";
import {
  type ElmJsonPath,
  type GetNow,
  markAsAbsolutePath,
  markAsElmJsonPath,
  markAsElmWatchStuffJsonPath,
  markAsTargetName,
  type OutputPath,
  type PackageTarget,
  type RunMode,
  type TargetName,
} from "../src/Types.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// `getOutputActions` decides what to compile next. These tests cover the
// ordering and queueing that the integration tests (HotMisc, SuccessfulMake)
// can only check loosely, since there it depends on timing.

const getNow: GetNow = () => new Date(0);

const noop = (): void => {
  // Do nothing.
};

// Shorthands for statuses.
const S = {
  dirty: {
    tag: "Success",
    elmFileSize: 0,
    postprocessFileSize: 0,
    elmCompiledTimestamp: 0,
  },
  clean: {
    tag: "Success",
    elmFileSize: 0,
    postprocessFileSize: 0,
    elmCompiledTimestamp: 0,
  },
  elmMake: {
    tag: "ElmMake",
    compilationMode: "standard",
    elmDurationMs: 0,
    walkerDurationMs: 0,
    injectDurationMs: 0,
    kill: noop,
  },
  typecheckOnly: {
    tag: "ElmMakeTypecheckOnly",
    elmDurationMs: 0,
    walkerDurationMs: 0,
    kill: noop,
  },
  postprocess: { tag: "Postprocess", kill: noop },
  queuedForElmMake: { tag: "QueuedForElmMake" },
  queuedForPostprocess: {
    tag: "QueuedForPostprocess",
    postprocess: { tag: "Postprocess", postprocessFunction: () => "" },
    code: "",
    elmCompiledTimestamp: 0,
    recordFields: undefined,
  },
  interrupted: { tag: "Interrupted" },
  error: {
    tag: "ReadOutputError",
    error: new Error("Test"),
    triedPath: markAsAbsolutePath("/project/build/Error.js"),
  },
} satisfies Record<string, OutputStatus>;

type StatusName = keyof typeof S;

type TargetSpec = [name: string, status: StatusName];

function makeProject({
  maxParallel = 2,
  elmJsons,
  packages = {},
}: {
  maxParallel?: number;
  // elm.json name -> targets using it.
  elmJsons: Record<string, Array<TargetSpec>>;
  // elm.json name -> package target using it.
  packages?: Record<string, TargetSpec>;
}): Project {
  const elmJsonPath = (name: string): ElmJsonPath =>
    markAsElmJsonPath(markAsAbsolutePath(`/project/${name}/elm.json`));

  return {
    watchDirs: [],
    missingSourceDirectories: new Set(),
    root: markAsAbsolutePath("/project"),
    staticFilesDir: undefined,
    configSource: { tag: "Options" },
    elmWatchStuffJsonPath: markAsElmWatchStuffJsonPath(
      markAsAbsolutePath("/project/elm-stuff/elm-watch/stuff.json"),
    ),
    disabledOutputs: [],
    targetsErrors: [],
    elmJsons: new Map(
      Object.entries(elmJsons).map(([elmJsonName, targets]) => [
        elmJsonPath(elmJsonName),
        targets.map(([name, statusName]): [OutputPath, OutputState] => {
          const outputPath: OutputPath = {
            tag: "OutputPath",
            theOutputPath: markAsAbsolutePath(`/project/build/${name}.js`),
            temporaryOutputPath: markAsAbsolutePath(
              `/project/elm-stuff/elm-watch/${name}.js`,
            ),
            originalString: `build/${name}.js`,
            targetName: markAsTargetName(name),
          };
          const inputPath = markAsAbsolutePath(`/project/src/${name}.elm`);
          const outputState = new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: inputPath,
                originalString: `src/${name}.elm`,
                realpath: inputPath,
              },
            ],
            { tag: "NoPostprocess" },
            "standard",
            getNow,
          );
          outputState.setStatus(S[statusName]);
          outputState.dirty = statusName === "dirty";
          return [outputPath, outputState];
        }),
      ]),
    ),
    packages: new Map(
      Object.entries(packages).map(([elmJsonName, [name, statusName]]) => {
        const packageTarget: PackageTarget = {
          tag: "PackageTarget",
          targetName: markAsTargetName(name),
        };
        const packageState: PackageState = new TargetState<PackageStatus>(
          { tag: "NotWrittenToDisk" },
          getNow,
        );
        if (statusName !== "dirty" && statusName !== "clean") {
          packageState.setStatus(S[statusName] as PackageStatus);
        }
        packageState.dirty = statusName === "dirty";
        return [elmJsonPath(elmJsonName), [packageTarget, packageState]];
      }),
    ),
    maxParallel,
    host: DEFAULT_HOST,
    webSocketUrl: undefined,
    allowedHosts: [],
    openEditor: { tag: "NotSet" },
  };
}

function priorities(record: Record<string, number>): Map<TargetName, number> {
  return new Map(
    Object.entries(record).map(([name, priority]) => [
      markAsTargetName(name),
      priority,
    ]),
  );
}

function run({
  project,
  runMode = "hot",
  includeInterrupted = true,
  prioritizedOutputs,
}: {
  project: Project;
  runMode?: RunMode;
  includeInterrupted?: boolean;
  prioritizedOutputs: Map<TargetName, number> | "AllEqualPriority";
}): string {
  return describeActions(
    getOutputActions({
      project,
      runMode,
      includeInterrupted,
      prioritizedOutputs,
    }),
  );
}

function describeActions(outputActions: OutputActions): string {
  const name = (output: { outputPath: { targetName: string } }): string =>
    output.outputPath.targetName;
  const lines = outputActions.actions.map((action) => {
    switch (action.tag) {
      case "NeedsElmMake":
        return `elm make: ${name(action.output)} (${action.source}, priority ${action.priority})`;
      case "NeedsElmMakeTypecheckOnly":
        return `typecheck only: ${action.outputs
          .map(({ output, source }) => `${name(output)} (${source})`)
          .join(", ")}`;
      case "NeedsElmMakePackage":
        return `typecheck package: ${name(action.package)} (${action.source})`;
      case "NeedsPostprocess":
        return `postprocess: ${name(action.output)} (priority ${action.priority})`;
      case "QueueForElmMake":
        return `queue: ${name(action.output)}`;
    }
  });
  const withoutAction = outputActions.outputsWithoutAction.map(name);
  return [
    ...(lines.length === 0 ? ["(no actions)"] : lines),
    `without action: ${withoutAction.length === 0 ? "-" : withoutAction.join(", ")}`,
    `executing: ${outputActions.numExecuting}, interrupted: ${outputActions.numInterrupted}, errors: ${outputActions.numErrors}`,
  ].join("\n");
}

describe("getOutputActions", () => {
  describe("hot", () => {
    // Mirrors “prioritize last focused target” in HotMisc.test.ts.
    test("prioritize last focused target", () => {
      // Both depend on a changed file. `Two` loaded last, so it gets priority.
      expect(
        run({
          project: makeProject({
            elmJsons: {
              app: [
                ["One", "dirty"],
                ["Two", "dirty"],
              ],
            },
          }),
          prioritizedOutputs: priorities({ One: 1, Two: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: Two (Dirty, priority 2)
        queue: One
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);

      // Only one `elm make` per elm.json at a time.
      expect(
        run({
          project: makeProject({
            elmJsons: {
              app: [
                ["One", "queuedForElmMake"],
                ["Two", "elmMake"],
              ],
            },
          }),
          prioritizedOutputs: priorities({ One: 1, Two: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        (no actions)
        without action: Two, One
        executing: 1, interrupted: 0, errors: 0
      `);

      expect(
        run({
          project: makeProject({
            elmJsons: {
              app: [
                ["One", "queuedForElmMake"],
                ["Two", "clean"],
              ],
            },
          }),
          prioritizedOutputs: priorities({ One: 1, Two: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: One (Queued, priority 1)
        without action: Two
        executing: 0, interrupted: 0, errors: 0
      `);

      // After focusing `One`, it goes first instead.
      expect(
        run({
          project: makeProject({
            elmJsons: {
              app: [
                ["One", "dirty"],
                ["Two", "dirty"],
              ],
            },
          }),
          prioritizedOutputs: priorities({ One: 3, Two: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: One (Dirty, priority 3)
        queue: Two
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);
    });

    // Mirrors “typecheck only” in HotMisc.test.ts: Targets that no browser has
    // connected to are only typechecked, all together in one `elm make`.
    test("typecheck only", () => {
      const elmJsons = (
        statuses: [StatusName, StatusName, StatusName, StatusName],
      ): Record<string, Array<TargetSpec>> => ({
        app: [
          ["Main1", statuses[0]],
          ["Main2", statuses[1]],
          ["Main3", statuses[2]],
          ["Main4", statuses[3]],
        ],
      });

      // Before any browser has connected.
      expect(
        run({
          project: makeProject({
            elmJsons: elmJsons(["dirty", "dirty", "dirty", "dirty"]),
          }),
          prioritizedOutputs: priorities({}),
        }),
      ).toMatchInlineSnapshot(`
        typecheck only: Main1 (Dirty), Main2 (Dirty), Main3 (Dirty), Main4 (Dirty)
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);

      // Main3 and Main4 connected, Main4 most recently.
      expect(
        run({
          project: makeProject({
            elmJsons: elmJsons(["dirty", "dirty", "dirty", "dirty"]),
          }),
          prioritizedOutputs: priorities({ Main3: 1, Main4: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: Main4 (Dirty, priority 2)
        queue: Main3
        queue: Main1
        queue: Main2
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);

      // Main4 is done. Main3 goes next, before the typecheck only targets.
      expect(
        run({
          project: makeProject({
            elmJsons: elmJsons([
              "queuedForElmMake",
              "queuedForElmMake",
              "queuedForElmMake",
              "clean",
            ]),
          }),
          prioritizedOutputs: priorities({ Main3: 1, Main4: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: Main3 (Queued, priority 1)
        without action: Main4, Main1, Main2
        executing: 0, interrupted: 0, errors: 0
      `);

      expect(
        run({
          project: makeProject({
            elmJsons: elmJsons([
              "queuedForElmMake",
              "queuedForElmMake",
              "clean",
              "clean",
            ]),
          }),
          prioritizedOutputs: priorities({ Main3: 1, Main4: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        typecheck only: Main1 (Queued), Main2 (Queued)
        without action: Main3, Main4
        executing: 0, interrupted: 0, errors: 0
      `);
    });

    test("different elm.json files compile in parallel, up to maxParallel", () => {
      expect(
        run({
          project: makeProject({
            maxParallel: 2,
            elmJsons: {
              a: [["A", "dirty"]],
              b: [["B", "dirty"]],
              c: [["C", "dirty"]],
            },
          }),
          prioritizedOutputs: priorities({ A: 1, B: 3, C: 2 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: B (Dirty, priority 3)
        elm make: C (Dirty, priority 2)
        queue: A
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);
    });

    test("postprocess goes before elm make", () => {
      expect(
        run({
          project: makeProject({
            maxParallel: 1,
            elmJsons: {
              a: [["A", "dirty"]],
              b: [["B", "queuedForPostprocess"]],
            },
          }),
          prioritizedOutputs: priorities({ A: 2, B: 1 }),
        }),
      ).toMatchInlineSnapshot(`
        postprocess: B (priority 1)
        queue: A
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);
    });

    test("packages go last, and wait for their elm.json", () => {
      expect(
        run({
          project: makeProject({
            maxParallel: 4,
            elmJsons: { app: [["App", "dirty"]] },
            packages: { app: ["Package", "dirty"], other: ["Other", "dirty"] },
          }),
          prioritizedOutputs: priorities({ App: 1 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: App (Dirty, priority 1)
        typecheck package: Other (Dirty)
        queue: Package
        without action: -
        executing: 0, interrupted: 0, errors: 0
      `);
    });

    test("interrupted outputs are only compiled when asked to", () => {
      const project = makeProject({
        elmJsons: { a: [["A", "interrupted"]], b: [["B", "error"]] },
      });
      expect(
        run({
          project,
          includeInterrupted: false,
          prioritizedOutputs: priorities({ A: 1 }),
        }),
      ).toMatchInlineSnapshot(`
        (no actions)
        without action: A, B
        executing: 0, interrupted: 1, errors: 1
      `);
      expect(
        run({
          project,
          includeInterrupted: true,
          prioritizedOutputs: priorities({ A: 1 }),
        }),
      ).toMatchInlineSnapshot(`
        elm make: A (Dirty, priority 1)
        without action: B
        executing: 0, interrupted: 1, errors: 1
      `);
    });
  });

  describe("make", () => {
    // Mirrors “multiple postprocess, with queued postprocess” in
    // SuccessfulMake.test.ts: Only 2 things run in parallel, so postprocess for
    // the third target has to wait until something else is done.
    test("queued postprocess", () => {
      expect(
        run({
          runMode: "make",
          project: makeProject({
            maxParallel: 2,
            elmJsons: {
              app: [
                ["main", "postprocess"],
                ["second", "elmMake"],
                ["third", "queuedForPostprocess"],
              ],
            },
          }),
          prioritizedOutputs: "AllEqualPriority",
        }),
      ).toMatchInlineSnapshot(`
        (no actions)
        without action: main, second, third
        executing: 2, interrupted: 0, errors: 0
      `);

      expect(
        run({
          runMode: "make",
          project: makeProject({
            maxParallel: 2,
            elmJsons: {
              app: [
                ["main", "clean"],
                ["second", "elmMake"],
                ["third", "queuedForPostprocess"],
              ],
            },
          }),
          prioritizedOutputs: "AllEqualPriority",
        }),
      ).toMatchInlineSnapshot(`
        postprocess: third (priority 0)
        without action: main, second
        executing: 1, interrupted: 0, errors: 0
      `);
    });

    // In make mode, finding type errors quickly matters more.
    test("elm make goes before postprocess", () => {
      expect(
        run({
          runMode: "make",
          project: makeProject({
            maxParallel: 1,
            elmJsons: {
              a: [["A", "dirty"]],
              b: [["B", "queuedForPostprocess"]],
            },
          }),
          prioritizedOutputs: "AllEqualPriority",
        }),
      ).toMatchInlineSnapshot(`
        elm make: A (Dirty, priority 0)
        without action: B
        executing: 0, interrupted: 0, errors: 0
      `);
    });
  });
});
