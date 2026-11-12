import * as Compile from "./Compile.ts";
import type { Env } from "./Env.ts";
import { getSnapshot } from "./ExternalErrors.ts";
import { bold, printDurationMs } from "./Helpers.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import type { Project } from "./Project.ts";
import type { Terminal, TerminalConfig } from "./Terminal.ts";
import type { GetNow } from "./Types.ts";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  terminal: Terminal,
  getNow: GetNow,
  project: Project,
): Promise<MakeResult> {
  const startTimestamp = getNow().getTime();

  const installResult = await Compile.installDependencies(
    env,
    terminal,
    getNow,
    project,
  ).promise;

  switch (installResult.tag) {
    case "Error":
    case "Killed":
      return { tag: "Error" };

    case "Success":
      // Continue below.
      break;
  }

  const initialOutputActions = Compile.getOutputActions({
    project,
    runMode: "make",
    includeInterrupted: true,
    prioritizedOutputs: "AllEqualPriority",
  });

  // `make` uses “fail fast.” _One_ of these error categories are shown at a time:
  // 1. All elm.json errors.
  // 2. All `elm make` errors.
  // 3. First postprocess error (likely the same error for all of them (bad
  //    command), and they might be slow.)
  if (
    isNonEmptyArray(initialOutputActions.actions) &&
    !isNonEmptyArray(project.targetsErrors)
  ) {
    terminal.withSynchronizedOutput(() => {
      Compile.printStatusLinesForTargetsErrors(terminal, project);
      Compile.printSpaceForOutputs(terminal, "make", initialOutputActions);
    });

    await new Promise<void>((resolve, reject) => {
      const cycle = (outputActions: Compile.OutputActions): void => {
        for (const action of outputActions.actions) {
          Compile.handleOutputAction({
            env,
            terminal,
            getNow,
            runMode: { tag: "make" },
            total: outputActions.total,
            action,
          })
            .then(() => {
              const nextOutputActions = getNextOutputActions(project);
              if (isNonEmptyArray(nextOutputActions.actions)) {
                cycle(nextOutputActions);
              } else if (nextOutputActions.numExecuting === 0) {
                resolve();
              }
            })
            .catch(reject);
        }
      };
      cycle(initialOutputActions);
    });
  } else {
    terminal.withSynchronizedOutput(() => {
      Compile.printStatusLinesForTargetsErrors(terminal, project);
    });
  }

  // Errors from outside elm-watch might have been reported while compiling.
  project.externalErrors = getSnapshot(project.errorReporter);
  const errors = Compile.extractErrors(project);
  const failed = isNonEmptyArray(errors);

  terminal.withSynchronizedOutput(() => {
    if (failed) {
      Compile.printErrors(terminal, errors);
    }

    const duration = getNow().getTime() - startTimestamp;
    terminal.write("");
    terminal.write(
      compileFinishedMessage({
        terminalConfig: terminal.config,
        duration,
        hasErrors: failed,
      }),
    );
  });

  return failed ? { tag: "Error" } : { tag: "Success" };
}

function getNextOutputActions(project: Project): Compile.OutputActions {
  const nextOutputActions = Compile.getOutputActions({
    project,
    runMode: "make",
    includeInterrupted: true,
    prioritizedOutputs: "AllEqualPriority",
  });
  // Skip postprocess if there are any errors (fail fast).
  return nextOutputActions.numErrors > 0
    ? {
        ...nextOutputActions,
        actions: nextOutputActions.actions.filter(
          (action2) => action2.tag !== "NeedsPostprocess",
        ),
      }
    : nextOutputActions;
}

function compileFinishedMessage({
  terminalConfig,
  duration,
  hasErrors,
}: {
  terminalConfig: TerminalConfig;
  duration: number;
  hasErrors: boolean;
}): string {
  return Compile.printStatusLine({
    maxWidth: Infinity,
    fancy: terminalConfig.fancy,
    isTTY: terminalConfig.isTTY,
    emojiName: hasErrors ? "Error" : "Success",
    string: `Compilation finished in ${bold(
      printDurationMs(terminalConfig.mockedTimings ? 123 : duration).trim(),
    )}.`,
  });
}
