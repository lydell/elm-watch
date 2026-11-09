import * as path from "path";
import { describe, expect, test } from "vitest";

import type { InstallDependenciesResult } from "../src/Compile.ts";
import { type Cmd, init, type Model, type Msg, update } from "../src/Hot.ts";
import type { LoggerConfig } from "../src/Logger.ts";
import type { Project } from "../src/Project.ts";
import {
  type AbsolutePath,
  markAsAbsolutePath,
  markAsTargetName,
} from "../src/Types.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";
import {
  elmFilePath,
  elmJsonPath,
  makeProject,
  type TargetSpec,
} from "./ProjectHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// Hot.ts is a TEA program: `update` is pure, and all side effects happen in
// `runCmd`. These tests feed messages directly to `update`, which makes it
// possible to test races (like a file changing while installing dependencies)
// deterministically. The integration tests in Hot*.test.ts depend on timing.
//
// In the real program, some commands (like `MarkAsDirty` and
// `CompileAllOutputsAsNeeded`) mutate the project. Here, each step instead
// says what the project looks like.

const loggerConfig: LoggerConfig = {
  debug: false,
  noColor: true,
  fancy: false,
  isTTY: false,
  mockedTimings: true,
  columns: 80,
  rows: 24,
};

const date = new Date(0);

const sharedElmFile = elmFilePath("Shared");
const unrelatedElmFile = elmFilePath("Unrelated");
const appElmJson = elmJsonPath("app");

function idleProject(
  targets: Array<TargetSpec> = [["Main", "clean"]],
): Project {
  return makeProject({ elmJsons: { app: targets } });
}

const msg = {
  watcherEvent: (absolutePath: AbsolutePath): Msg => ({
    tag: "GotWatcherEvent",
    date,
    absolutePath,
  }),
  sleepDone: ({
    removedPaths = [],
    changedSourceDirectories = [],
  }: {
    removedPaths?: Array<AbsolutePath>;
    changedSourceDirectories?: Array<AbsolutePath>;
  } = {}): Msg => ({
    tag: "SleepBeforeNextActionDone",
    date,
    removedPaths: new Set(removedPaths),
    changedSourceDirectories,
  }),
  installDone: (tag: InstallDependenciesResult["tag"]): Msg => ({
    tag: "InstallDependenciesDone",
    date,
    installResult: { tag },
  }),
  compilationPartDone: (): Msg => ({
    tag: "CompilationPartDone",
    date,
    prioritizedOutputs: new Map([[markAsTargetName("Main"), 1]]),
    handleOutputActionResult: { tag: "Nothing" },
  }),
  exitRequested: (): Msg => ({ tag: "ExitRequested", date }),
};

class Simulation {
  private project: Project;

  private model: Model;

  private readonly transcript: Array<string> = [];

  private readonly exitOnError: boolean;

  constructor(
    project: Project,
    { exitOnError = false }: { exitOnError?: boolean } = {},
  ) {
    const [model, cmds] = init(date, [], []);
    this.project = project;
    this.model = model;
    this.exitOnError = exitOnError;
    this.log("init", cmds);
  }

  send(message: Msg, project: Project = this.project): this {
    this.project = project;
    const [model, cmds] = update(
      loggerConfig,
      project,
      this.exitOnError,
      message,
      this.model,
    );
    this.model = model;
    this.log(describeMsg(message), cmds);
    return this;
  }

  // Shortcut for a file changing: The watcher event, and then the sleep
  // (debounce) being done.
  change(absolutePath: AbsolutePath, project?: Project): this {
    return this.send(msg.watcherEvent(absolutePath), project).send(
      msg.sleepDone(),
    );
  }

  toString(): string {
    return this.transcript.join("\n\n");
  }

  private log(what: string, cmds: Array<Cmd>): void {
    const { hotState, nextAction, latestEvents, pendingWatcherEvents } =
      this.model;
    this.transcript.push(
      [
        `> ${what}`,
        `  state: ${hotState.tag}, next: ${nextAction.tag}, events: ${latestEvents.length}, pending: ${pendingWatcherEvents.length}`,
        ...cmds
          .filter((cmd) => cmd.tag !== "NoCmd")
          .map((cmd) => `  cmd: ${describeCmd(cmd)}`),
      ].join("\n"),
    );
  }
}

function describeMsg(message: Msg): string {
  switch (message.tag) {
    case "GotWatcherEvent":
      return `${message.tag} ${shortPath(message.absolutePath)}`;
    case "InstallDependenciesDone":
      return `${message.tag} ${message.installResult.tag}`;
    case "SleepBeforeNextActionDone": {
      const removed = Array.from(message.removedPaths, shortPath);
      return removed.length === 0
        ? message.tag
        : `${message.tag} (removed: ${removed.join(", ")})`;
    }
    default:
      return message.tag;
  }
}

function describeCmd(cmd: Cmd): string {
  switch (cmd.tag) {
    case "CompileAllOutputsAsNeeded":
      return `${cmd.tag} ${cmd.mode}`;
    case "MarkAsDirty":
      return `${cmd.tag} ${cmd.outputs
        .map(({ outputPath }) => outputPath.targetName)
        .join(", ")}${cmd.killInstallDependencies ? " (kill install)" : ""}`;
    case "LogInfoMessageWithTimeline":
      return `${cmd.tag}: ${
        cmd.message.replace(/\x1B\[\d+m/g, "").split("\n")[0] ?? ""
      }`;
    case "RespondToOutputRequests":
      return `${cmd.tag} ${cmd.waiting}`;
    case "Restart":
      return `${cmd.tag} (${cmd.restartReasons
        .map((event) =>
          event.tag === "WatcherEvent" && event.file.tag === "AbsolutePath"
            ? `${event.eventName} ${shortPath(event.file.absolutePath)}`
            : event.tag,
        )
        .join(", ")})`;
    case "Throw":
      return `${cmd.tag}: ${cmd.error.message}`;
    default:
      return cmd.tag;
  }
}

function shortPath(absolutePath: AbsolutePath): string {
  return path.relative("/project", absolutePath);
}

describe("Hot update", () => {
  test("change while idle", () => {
    expect(
      new Simulation(idleProject())
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .change(sharedElmFile)
        .send(msg.compilationPartDone())
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > GotWatcherEvent src/Shared.elm
        state: Idle, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Compiling, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main
        cmd: CompileAllOutputsAsNeeded AfterIdle

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.
    `);
  });

  test("change while compiling continues the compilation", () => {
    expect(
      new Simulation(idleProject([["Main", "elmMake"]]))
        .send(msg.installDone("Success"))
        .change(sharedElmFile)
        .send(msg.compilationPartDone(), idleProject([["Main", "dirty"]]))
        .send(msg.compilationPartDone(), idleProject())
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > GotWatcherEvent src/Shared.elm
        state: Compiling, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Compiling, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main
        cmd: CompileAllOutputsAsNeeded ContinueCompilation

      > CompilationPartDone
        state: Compiling, next: NoAction, events: 1, pending: 0
        cmd: RespondToOutputRequests KeepWaiting
        cmd: CompileAllOutputsAsNeeded ContinueCompilation

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.
    `);
  });

  test("change while installing dependencies waits for the install", () => {
    expect(
      new Simulation(idleProject([["Main", "dirty"]]))
        .change(sharedElmFile)
        .send(msg.installDone("Success"))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > GotWatcherEvent src/Shared.elm
        state: Dependencies, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Dependencies, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 1, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies
    `);
  });

  test("unrelated changes only log", () => {
    expect(
      new Simulation(idleProject())
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .change(unrelatedElmFile)
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > GotWatcherEvent src/Unrelated.elm
        state: Idle, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: LogInfoMessageWithTimeline: FYI: The above Elm file is not imported by any target. Nothing to do!
    `);
  });

  // Mirrors “Restart while installing dependencies” in
  // HotReloadingCompilation.test.ts.
  test("restart while installing dependencies", () => {
    expect(
      new Simulation(idleProject())
        .change(appElmJson)
        // Installing is killed. Restart once that is confirmed.
        .send(msg.installDone("Killed"))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > GotWatcherEvent app/elm.json
        state: Dependencies, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main (kill install)

      > InstallDependenciesDone Killed
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: Restart (changed app/elm.json)
    `);
  });

  test("restart while installing dependencies, which finishes anyway", () => {
    expect(
      new Simulation(idleProject())
        .change(appElmJson)
        .send(msg.installDone("Success"))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > GotWatcherEvent app/elm.json
        state: Dependencies, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main (kill install)

      > InstallDependenciesDone Success
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: Restart (changed app/elm.json)
    `);
  });

  // Mirrors “Restart while `elm make` is running” in
  // HotReloadingCompilation.test.ts.
  test("restart while compiling waits for running compilations", () => {
    expect(
      new Simulation(
        idleProject([
          ["Main", "elmMake"],
          ["Other", "elmMake"],
        ]),
      )
        .send(msg.installDone("Success"))
        .change(appElmJson)
        // One is still executing.
        .send(
          msg.compilationPartDone(),
          idleProject([
            ["Main", "interrupted"],
            ["Other", "elmMake"],
          ]),
        )
        .send(
          msg.compilationPartDone(),
          idleProject([
            ["Main", "interrupted"],
            ["Other", "interrupted"],
          ]),
        )
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > GotWatcherEvent app/elm.json
        state: Compiling, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main, Other (kill install)

      > CompilationPartDone
        state: Restarting, next: NoAction, events: 1, pending: 0

      > CompilationPartDone
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: Restart (changed app/elm.json)
    `);
  });

  test("several events for the same file are handled once", () => {
    expect(
      new Simulation(idleProject())
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .send(msg.watcherEvent(sharedElmFile))
        .send(msg.watcherEvent(sharedElmFile))
        .send(msg.watcherEvent(sharedElmFile))
        .send(msg.sleepDone())
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > GotWatcherEvent src/Shared.elm
        state: Idle, next: NoAction, events: 0, pending: 1

      > GotWatcherEvent src/Shared.elm
        state: Idle, next: NoAction, events: 0, pending: 2

      > GotWatcherEvent src/Shared.elm
        state: Idle, next: NoAction, events: 0, pending: 3

      > SleepBeforeNextActionDone
        state: Compiling, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main
        cmd: CompileAllOutputsAsNeeded AfterIdle
    `);
  });

  test("removing an input file restarts", () => {
    const input = elmFilePath("Main");
    expect(
      new Simulation(idleProject())
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .send(msg.watcherEvent(input))
        .send(msg.sleepDone({ removedPaths: [input] }))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > GotWatcherEvent src/Main.elm
        state: Idle, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone (removed: src/Main.elm)
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main (kill install)
        cmd: ClearScreen
        cmd: Restart (removed src/Main.elm)
    `);
  });

  test("a source directory appearing restarts", () => {
    const lib = markAsAbsolutePath("/project/lib");
    const project = idleProject();
    project.missingSourceDirectories.add(lib);
    expect(
      new Simulation(project)
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .send(msg.watcherEvent(lib))
        .send(msg.sleepDone({ changedSourceDirectories: [lib] }))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > GotWatcherEvent lib
        state: Idle, next: NoAction, events: 0, pending: 1

      > SleepBeforeNextActionDone
        state: Restarting, next: NoAction, events: 1, pending: 0
        cmd: MarkAsDirty Main (kill install)
        cmd: ClearScreen
        cmd: Restart (changed lib)
    `);
  });

  test("errors", () => {
    expect(
      new Simulation(idleProject([["Main", "error"]]), { exitOnError: true })
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone())
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: PrintCompileErrors
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.
        cmd: ExitOnIdle
    `);
  });

  test("install error", () => {
    expect(
      new Simulation(idleProject(), { exitOnError: true })
        .send(msg.installDone("Error"))
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > InstallDependenciesDone Error
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondToAll
        cmd: ExitOnIdle
    `);
  });

  test("exit is only allowed when idle", () => {
    expect(
      new Simulation(idleProject([["Main", "elmMake"]]))
        .send(msg.exitRequested())
        .send(msg.installDone("Success"))
        .send(msg.compilationPartDone(), idleProject())
        .send(msg.exitRequested())
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: ClearScreen
        cmd: InstallDependencies

      > ExitRequested
        state: Dependencies, next: NoAction, events: 0, pending: 0
        cmd: Throw: Got ExitRequested. Expected hotState to be Idle but it is: Dependencies

      > InstallDependenciesDone Success
        state: Compiling, next: NoAction, events: 0, pending: 0
        cmd: CompileAllOutputsAsNeeded AfterInstallDependencies

      > CompilationPartDone
        state: Idle, next: NoAction, events: 0, pending: 0
        cmd: RespondToOutputRequests RespondIfNotDirty
        cmd: HandleElmWatchStuffJsonWriteError
        cmd: LogInfoMessageWithTimeline: Compilation finished in 123 ms.

      > ExitRequested
        state: Idle, next: NoAction, events: 0, pending: 0
    `);
  });
});
