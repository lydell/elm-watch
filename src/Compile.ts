import * as fs from "fs";
import * as readline from "readline";

import * as ElmJson from "./ElmJson";
import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { HashMap } from "./HashMap";
import {
  bold,
  cursorHorizontalAbsolute,
  dim,
  Env,
  join,
  silentlyReadIntEnvValue,
  toError,
} from "./Helpers";
import {
  walkImports,
  WalkImportsError,
  WalkImportsResult,
} from "./ImportWalker";
import * as Inject from "./Inject";
import { Logger } from "./Logger";
import {
  flattenNonEmptyArray,
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
  nonEmptyArrayUniqueBy,
} from "./NonEmptyArray";
import { absoluteDirname } from "./PathHelpers";
import { Port } from "./Port";
import {
  Postprocess,
  PostprocessWorkerPool,
  runPostprocess,
  WORKER_TERMINATED,
} from "./Postprocess";
import { Duration, OutputError, OutputState, Project } from "./Project";
import { SPAWN_KILLED } from "./Spawn";
import * as SpawnElm from "./SpawnElm";
import {
  AbsolutePath,
  CompilationMode,
  ElmJsonPath,
  ElmWatchJsonPath,
  GetNow,
  InputPath,
  OutputPath,
  RunMode,
} from "./Types";

type WithDuration<T> = T & { durationMs: number };

export type InstallDependenciesResult = { tag: "Error" } | { tag: "Success" };

// Make sure all dependencies are installed. Otherwise compilation sometimes
// fails when you’ve got multiple outputs for the same elm.json. The error is
// “not enough bytes”/“corrupt file” for `elm-stuff/0.19.1/{d,i,o}.dat`.
// This is done in sequence, in an attempt to avoid:
// - Downloading the same package twice.
// - Two Elm processes writing to `~/.elm` at the same time.
export async function installDependencies(
  env: Env,
  logger: Logger,
  project: Project
): Promise<InstallDependenciesResult> {
  const loadingMessageDelay = silentlyReadIntEnvValue(
    env.__ELM_WATCH_LOADING_MESSAGE_DELAY,
    100
  );

  const printStatusLineHelper = (
    emojiName: EmojiName,
    message: string,
    nonFancy: string
  ): string =>
    printStatusLine({
      maxWidth: logger.raw.stderrColumns,
      fancy: logger.fancy,
      isTTY: logger.raw.stderr.isTTY,
      emojiName,
      string: logger.fancy ? message : `${message}: ${nonFancy}`,
    });

  const elmJsonsArray = Array.from(project.elmJsons);

  for (const [index, [elmJsonPath]] of elmJsonsArray.entries()) {
    // Don’t print `(x/y)` the first time, because chances are all packages are
    // downloaded via the first elm.json and that looks nicer.
    const message = `Dependencies${
      index === 0 ? "" : ` (${index + 1}/${elmJsonsArray.length})`
    }`;

    const loadingMessage = printStatusLineHelper(
      "Busy",
      message,
      "in progress"
    );

    // Avoid printing `loadingMessage` if there’s nothing to download.
    let didWriteLoadingMessage = false;
    const timeoutId = setTimeout(() => {
      logger.error(loadingMessage);
      didWriteLoadingMessage = true;
    }, loadingMessageDelay);

    const clearLoadingMessage = (): void => {
      if (didWriteLoadingMessage && logger.raw.stderr.isTTY) {
        readline.moveCursor(logger.raw.stderr, 0, -1);
        readline.clearLine(logger.raw.stderr, 0);
      }
    };

    const onError = (
      error: Errors.ErrorTemplate
    ): InstallDependenciesResult => {
      clearLoadingMessage();
      logger.error(printStatusLineHelper("Error", message, "error"));
      logger.error("");
      logger.errorTemplate(error);
      return { tag: "Error" };
    };

    const result = await SpawnElm.install({ elmJsonPath, env });
    clearTimeout(timeoutId);

    switch (result.tag) {
      // If the elm.json is invalid we can just ignore that and let the “real”
      // compilation later catch it. This way we get colored error messages.
      case "ElmJsonError":
        if (didWriteLoadingMessage) {
          clearLoadingMessage();
          logger.error(printStatusLineHelper("Skipped", message, "skipped"));
        }
        break;

      case "Success": {
        const gotOutput = result.elmInstallOutput !== "";
        if (didWriteLoadingMessage || gotOutput) {
          clearLoadingMessage();
          logger.error(printStatusLineHelper("Success", message, "success"));
        }
        if (gotOutput) {
          logger.error(result.elmInstallOutput);
        }
        break;
      }

      case "CreatingDummyFailed":
        return onError(Errors.creatingDummyFailed(elmJsonPath, result.error));

      case "ElmNotFoundError":
        return onError(Errors.elmNotFoundError(elmJsonPath, result.command));

      // istanbul ignore next
      case "OtherSpawnError":
        return onError(
          Errors.otherSpawnError(elmJsonPath, result.error, result.command)
        );

      case "ElmInstallError":
        return onError(
          Errors.elmInstallError(elmJsonPath, result.title, result.message)
        );

      case "UnexpectedElmInstallOutput":
        return onError(
          Errors.unexpectedElmInstallOutput(
            elmJsonPath,
            result.exitReason,
            result.stdout,
            result.stderr,
            result.command
          )
        );
    }
  }

  return { tag: "Success" };
}

type IndexedOutput = {
  index: number;
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
};

type IndexedOutputWithSource = {
  output: IndexedOutput;
  source: "Dirty" | "Queued";
};

export type OutputAction =
  | NeedsElmMakeOutputAction
  | NeedsElmMakeTypecheckOnlyOutputAction
  | NeedsPostprocessOutputAction
  | QueueForElmMakeOutputAction;

type NeedsElmMakeOutputAction = IndexedOutputWithSource & {
  tag: "NeedsElmMake";
  priority: number;
};

type NeedsElmMakeTypecheckOnlyOutputAction = {
  tag: "NeedsElmMakeTypecheckOnly";
  elmJsonPath: ElmJsonPath;
  outputs: NonEmptyArray<IndexedOutputWithSource>;
};

type NeedsPostprocessOutputAction = {
  tag: "NeedsPostprocess";
  output: IndexedOutput;
  postprocessArray: NonEmptyArray<string>;
  priority: number;
  code: Buffer | string;
  elmCompiledTimestamp: number;
};

type QueueForElmMakeOutputAction = {
  tag: "QueueForElmMake";
  output: IndexedOutput;
};

export type OutputActions = {
  total: number;
  numExecuting: number;
  numInterrupted: number;
  numErrors: number;
  actions: Array<OutputAction>;
  outputsWithoutAction: Array<IndexedOutput>;
};

export function getOutputActions({
  project,
  runMode,
  includeInterrupted,
  prioritizedOutputs,
}: {
  project: Project;
  runMode: RunMode;
  includeInterrupted: boolean;
  prioritizedOutputs: HashMap<OutputPath, number> | "AllEqualPriority";
}): OutputActions {
  let index = 0;
  let numExecuting = 0;
  let numInterrupted = 0;
  let numErrors = 0;
  const elmMakeActions: Array<NeedsElmMakeOutputAction> = [];
  const elmMakeTypecheckOnlyActions: Array<NeedsElmMakeTypecheckOnlyOutputAction> =
    [];
  const postprocessActions: Array<NeedsPostprocessOutputAction> = [];
  const queueActions: Array<QueueForElmMakeOutputAction> = [];
  const outputsWithoutAction: Array<IndexedOutput> = [];

  const queueTypecheckOnly = (
    typecheckOnly: NonEmptyArray<IndexedOutputWithSource>
  ): void => {
    for (const { output, source } of typecheckOnly) {
      switch (source) {
        case "Dirty":
          queueActions.push({
            tag: "QueueForElmMake",
            output,
          });
          break;

        case "Queued":
          outputsWithoutAction.push(output);
          break;
      }
    }
  };

  for (const [elmJsonPath, outputs] of project.elmJsons) {
    let elmMakeBusy = Array.from(outputs.values()).some((outputState) => {
      switch (outputState.status.tag) {
        case "ElmMake":
        case "ElmMakeTypecheckOnly":
          return true;
        default:
          return false;
      }
    });

    const typecheckOnly: Array<IndexedOutputWithSource> = [];

    for (const [outputPath, outputState] of outputs) {
      const output: IndexedOutput = {
        index,
        elmJsonPath,
        outputPath,
        outputState,
      };
      index++;

      const priority =
        prioritizedOutputs === "AllEqualPriority"
          ? 0
          : prioritizedOutputs.get(outputPath);

      // eslint-disable-next-line @typescript-eslint/no-loop-func
      const needsElmMakeOrQueue = (): void => {
        if (elmMakeBusy) {
          queueActions.push({
            tag: "QueueForElmMake",
            output,
          });
        } else if (priority !== undefined) {
          elmMakeActions.push({
            tag: "NeedsElmMake",
            output,
            source: "Dirty",
            priority,
          });
          elmMakeBusy = true;
        } else {
          typecheckOnly.push({ output, source: "Dirty" });
        }
      };

      switch (outputState.status.tag) {
        case "ElmMake":
        case "ElmMakeTypecheckOnly":
        case "Postprocess":
          numExecuting++;
          outputsWithoutAction.push(output);
          break;

        case "QueuedForElmMake":
          if (elmMakeBusy) {
            outputsWithoutAction.push(output);
          } else {
            if (priority !== undefined) {
              elmMakeActions.push({
                tag: "NeedsElmMake",
                output,
                source: "Queued",
                priority,
              });
              elmMakeBusy = true;
            } else {
              typecheckOnly.push({ output, source: "Queued" });
            }
          }
          break;

        case "QueuedForPostprocess":
          postprocessActions.push({
            tag: "NeedsPostprocess",
            output,
            postprocessArray: outputState.status.postprocessArray,
            priority: priority ?? 0,
            code: outputState.status.code,
            elmCompiledTimestamp: outputState.status.elmCompiledTimestamp,
          });
          break;

        case "Interrupted":
          numInterrupted++;
          if (includeInterrupted) {
            needsElmMakeOrQueue();
          } else {
            outputsWithoutAction.push(output);
          }
          break;

        case "Success":
        case "NotWrittenToDisk":
          if (outputState.dirty) {
            needsElmMakeOrQueue();
          } else {
            outputsWithoutAction.push(output);
          }
          break;

        default: {
          // Make sure only error statuses are left.
          const _: OutputError = outputState.status;
          void _;
          numErrors++;
          if (outputState.dirty) {
            needsElmMakeOrQueue();
          } else {
            outputsWithoutAction.push(output);
          }
          break;
        }
      }
    }

    if (isNonEmptyArray(typecheckOnly)) {
      if (elmMakeBusy) {
        queueTypecheckOnly(typecheckOnly);
      } else {
        elmMakeTypecheckOnlyActions.push({
          tag: "NeedsElmMakeTypecheckOnly",
          elmJsonPath,
          outputs: typecheckOnly,
        });
      }
    }
  }

  const prioritizedActions = prioritizeActions(
    runMode,
    elmMakeActions,
    elmMakeTypecheckOnlyActions,
    postprocessActions
  );

  const threadsLeft = Math.max(0, project.maxParallel - numExecuting);

  const actions = prioritizedActions.slice(0, threadsLeft);

  for (const action of prioritizedActions.slice(threadsLeft)) {
    switch (action.tag) {
      case "NeedsElmMake":
        switch (action.source) {
          case "Dirty":
            queueActions.push({
              tag: "QueueForElmMake",
              output: action.output,
            });
            break;

          case "Queued":
            outputsWithoutAction.push(action.output);
            break;
        }
        break;

      case "NeedsElmMakeTypecheckOnly":
        queueTypecheckOnly(action.outputs);
        break;

      case "NeedsPostprocess":
        outputsWithoutAction.push(action.output);
        break;
    }
  }

  return {
    total: index,
    numExecuting,
    numInterrupted,
    numErrors,
    actions: [...actions, ...queueActions],
    outputsWithoutAction,
  };
}

function prioritizeActions(
  runMode: RunMode,
  elmMakeActions: Array<NeedsElmMakeOutputAction>,
  elmMakeTypecheckOnlyActions: Array<NeedsElmMakeTypecheckOnlyOutputAction>,
  postprocessActions: Array<NeedsPostprocessOutputAction>
): Array<
  | NeedsElmMakeOutputAction
  | NeedsElmMakeTypecheckOnlyOutputAction
  | NeedsPostprocessOutputAction
> {
  switch (runMode) {
    // In `make` mode, you want to find type errors as quickly as possible (the
    // most likely CI failure). Don’t let slow postprocessing delay that.
    // All outputs have the same priority in `make` mode so don’t bother sorting.
    case "make":
      return [
        ...elmMakeActions,
        ...elmMakeTypecheckOnlyActions,
        ...postprocessActions,
      ];

    // In `hot` mode, try to finish each output as fast as possible, rather than
    // make all of them “evenly slow”.
    case "hot":
      return [
        ...sortByPriority(postprocessActions),
        ...sortByPriority(elmMakeActions),
        ...elmMakeTypecheckOnlyActions,
      ];
  }
}

function sortByPriority<T extends { priority: number }>(
  array: Array<T>
): Array<T> {
  return array.slice().sort((a, b) => b.priority - a.priority);
}

export type HandleOutputActionResult =
  | {
      tag: "CompileError";
      outputPath: OutputPath;
    }
  | {
      tag: "FullyCompiledJS";
      outputPath: OutputPath;
      code: Buffer;
      elmCompiledTimestamp: number;
      compilationMode: CompilationMode;
    }
  | {
      tag: "Nothing";
    };

type RunModeWithExtraData =
  | {
      tag: "hot";
      webSocketPort: Port;
    }
  | {
      tag: "make";
    };

export async function handleOutputAction({
  env,
  logger,
  getNow,
  runMode,
  elmWatchJsonPath,
  total,
  action,
  postprocess,
  postprocessWorkerPool,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunModeWithExtraData;
  elmWatchJsonPath: ElmWatchJsonPath;
  total: number;
  action: OutputAction;
  postprocess: Postprocess;
  postprocessWorkerPool: PostprocessWorkerPool;
}): Promise<HandleOutputActionResult> {
  switch (action.tag) {
    case "NeedsElmMake":
      return compileOneOutput({
        env,
        logger,
        getNow,
        runMode,
        total,
        ...action.output,
        postprocess,
      });

    case "NeedsElmMakeTypecheckOnly":
      switch (runMode.tag) {
        case "make":
          return { tag: "Nothing" };

        case "hot":
          await typecheck({
            env,
            logger,
            getNow,
            runMode: runMode.tag,
            elmJsonPath: action.elmJsonPath,
            outputs: mapNonEmptyArray(action.outputs, ({ output }) => output),
            total,
            webSocketPort: runMode.webSocketPort,
          });
          return { tag: "Nothing" };
      }

    case "NeedsPostprocess":
      return postprocessHelper({
        env,
        logger,
        getNow,
        runMode,
        elmWatchJsonPath,
        total,
        ...action.output,
        postprocessArray: action.postprocessArray,
        postprocessWorkerPool,
        code: action.code,
        elmCompiledTimestamp: action.elmCompiledTimestamp,
      });

    case "QueueForElmMake":
      action.output.outputState.status = {
        tag: "QueuedForElmMake",
        startTimestamp: getNow().getTime(),
      };
      updateStatusLine({
        logger,
        runMode: runMode.tag,
        total,
        ...action.output,
      });
      return { tag: "Nothing" };
  }
}

async function compileOneOutput({
  env,
  logger,
  getNow,
  runMode,
  elmJsonPath,
  outputPath,
  outputState,
  index,
  total,
  postprocess,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunModeWithExtraData;
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
  postprocess: Postprocess;
}): Promise<HandleOutputActionResult> {
  const startTimestamp = getNow().getTime();

  const updateStatusLineHelper = (): void => {
    updateStatusLine({
      logger,
      runMode: runMode.tag,
      outputPath,
      outputState,
      index,
      total,
    });
  };

  // Watcher events that happen while waiting for `elm make` and
  // postprocessing can flip `dirty` back to `true`.
  outputState.dirty = false;
  outputState.status = {
    tag: "ElmMake",
    compilationMode: outputState.compilationMode,
    durations:
      outputState.status.tag === "QueuedForElmMake"
        ? [
            {
              tag: "QueuedForElmMake",
              durationMs: startTimestamp - outputState.status.startTimestamp,
            },
          ]
        : [],
  };
  updateStatusLineHelper();
  const [elmMakeResult, allRelatedElmFilePathsResult] = await Promise.all([
    SpawnElm.make({
      elmJsonPath,
      compilationMode: outputState.compilationMode,
      inputs: outputState.inputs,
      outputPath,
      env,
    }).then(
      (result): WithDuration<SpawnElm.RunElmMakeResult> => ({
        ...result,
        durationMs: getNow().getTime() - startTimestamp,
      })
    ),
    Promise.resolve().then(
      (): WithDuration<GetAllRelatedElmFilePathsResult> => {
        switch (runMode.tag) {
          case "make":
            return {
              tag: "Success",
              allRelatedElmFilePaths: outputState.allRelatedElmFilePaths,
              durationMs: -1,
            };
          case "hot":
            // Note: It doesn’t matter if a file changes before we’ve had
            // chance to compute this the first time (during packages
            // installation or `elm make` above). Everything is marked as
            // dirty by default anyway and will get compiled.
            return {
              ...getAllRelatedElmFilePaths(elmJsonPath, outputState.inputs),
              durationMs: getNow().getTime() - startTimestamp,
            };
        }
      }
    ),
  ]);

  if (outputState.dirty) {
    outputState.status = { tag: "Interrupted" };
    updateStatusLineHelper();
    return { tag: "Nothing" };
  }

  outputState.allRelatedElmFilePaths = allRelatedElmFilePathsWithFallback(
    allRelatedElmFilePathsResult,
    outputState
  );

  const combinedResult = combineResults(
    elmMakeResult,
    allRelatedElmFilePathsResult
  );

  switch (combinedResult.tag) {
    case "elm make success + walker success":
      return onCompileSuccess(
        getNow,
        updateStatusLineHelper,
        runMode,
        outputPath,
        outputState,
        {
          tag: "ElmMake",
          elmDurationMs: combinedResult.elmDurationMs,
          walkerDurationMs: combinedResult.walkerDurationMs,
        },
        postprocess
      );

    case "elm make success + walker failure":
      outputState.status = combinedResult.walkerError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };

    case "elm make failure + walker success":
      outputState.status = combinedResult.elmMakeError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };

    case "elm make failure + walker failure":
      // If `elm make` failed, don’t bother with `getAllRelatedElmFilePaths` errors.
      outputState.status = combinedResult.elmMakeError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };
  }
}

function onCompileSuccess(
  getNow: GetNow,
  updateStatusLineHelper: () => void,
  runMode: RunModeWithExtraData,
  outputPath: OutputPath,
  outputState: OutputState,
  duration: Duration,
  postprocess: Postprocess
): HandleOutputActionResult {
  const elmCompiledTimestamp = getNow().getTime();

  switch (runMode.tag) {
    case "make":
      switch (postprocess.tag) {
        case "NoPostprocess": {
          let fileSize;
          try {
            fileSize = fs.statSync(outputPath.theOutputPath.absolutePath).size;
          } catch (unknownError) {
            const error = toError(unknownError);
            outputState.status = { tag: "ReadOutputError", error };
            updateStatusLineHelper();
            return { tag: "CompileError", outputPath };
          }
          outputState.status = {
            tag: "Success",
            elmFileSize: fileSize,
            postprocessFileSize: fileSize,
            elmCompiledTimestamp,
            durations: appendDuration(outputState, [duration]),
          };
          updateStatusLineHelper();
          return { tag: "Nothing" };
        }

        case "Postprocess": {
          let buffer;
          try {
            buffer = fs.readFileSync(outputPath.theOutputPath.absolutePath);
          } catch (unknownError) {
            const error = toError(unknownError);
            outputState.status = { tag: "ReadOutputError", error };
            updateStatusLineHelper();
            return { tag: "CompileError", outputPath };
          }
          outputState.status = {
            tag: "QueuedForPostprocess",
            postprocessArray: postprocess.postprocessArray,
            code: buffer,
            elmCompiledTimestamp,
            durations: appendDuration(outputState, [duration]),
          };
          updateStatusLineHelper();
          return { tag: "Nothing" };
        }
      }

    case "hot": {
      let buffer;
      try {
        buffer = fs.readFileSync(outputPath.theOutputPath.absolutePath);
      } catch (unknownError) {
        const error = toError(unknownError);
        outputState.status = { tag: "ReadOutputError", error };
        updateStatusLineHelper();
        return { tag: "CompileError", outputPath };
      }

      // This will inject `elmCompiledTimestamp` into the built code, which is
      // later used to detect if recompiles are needed or not. Note: This needs
      // to be the timestamp of when Elm finished compiling, not when
      // postprocessing finished. That’s because we haven’t done the
      // postprocessing yet, but have to inject before that. So we’re storing
      // the timestamp when Elm finished rather than when the entire process was
      // finished.
      const result = Inject.inject(outputPath, buffer.toString("utf8"));

      const injectDuration: Duration = {
        tag: "Inject",
        durationMs: getNow().getTime() - elmCompiledTimestamp,
      };

      switch (result.tag) {
        case "InjectSearchAndReplaceNotFound":
          outputState.status = result;
          updateStatusLineHelper();
          return { tag: "CompileError", outputPath };

        case "Success":
          switch (postprocess.tag) {
            case "NoPostprocess": {
              const newBuffer = Buffer.from(result.code);
              try {
                fs.writeFileSync(
                  outputPath.theOutputPath.absolutePath,
                  Buffer.concat([
                    Buffer.from(
                      Inject.clientCode(
                        outputPath,
                        elmCompiledTimestamp,
                        outputState.compilationMode,
                        runMode.webSocketPort
                      )
                    ),
                    newBuffer,
                  ])
                );
              } catch (unknownError) {
                const error = toError(unknownError);
                outputState.status = {
                  tag: "WriteOutputError",
                  error,
                  reasonForWriting: "InjectWebSocketClient",
                };
                updateStatusLineHelper();
                return { tag: "CompileError", outputPath };
              }
              outputState.status = {
                tag: "Success",
                elmFileSize: newBuffer.byteLength,
                postprocessFileSize: newBuffer.byteLength,
                elmCompiledTimestamp,
                durations: appendDuration(outputState, [
                  duration,
                  injectDuration,
                ]),
              };
              updateStatusLineHelper();
              return {
                tag: "FullyCompiledJS",
                outputPath,
                code: newBuffer,
                elmCompiledTimestamp,
                compilationMode: outputState.compilationMode,
              };
            }

            case "Postprocess": {
              outputState.status = {
                tag: "QueuedForPostprocess",
                postprocessArray: postprocess.postprocessArray,
                code: result.code,
                elmCompiledTimestamp,
                durations: appendDuration(outputState, [
                  duration,
                  injectDuration,
                ]),
              };
              updateStatusLineHelper();
              return { tag: "Nothing" };
            }
          }
      }
    }
  }
}

type NeedsToWriteProxyFileResult =
  | {
      tag: "Needed";
    }
  | {
      tag: "NotNeeded";
    }
  | {
      tag: "ReadError";
      error: Error;
    };

function needsToWriteProxyFile(
  outputPath: AbsolutePath,
  versionedIdentifier: Buffer
): NeedsToWriteProxyFileResult {
  let handle;
  try {
    handle = fs.openSync(outputPath.absolutePath, "r");
  } catch (unknownError) {
    const error = toError(unknownError);
    return error.code === "ENOENT"
      ? { tag: "Needed" }
      : { tag: "ReadError", error };
  }
  const buffer = Buffer.alloc(versionedIdentifier.byteLength);
  try {
    fs.readSync(handle, buffer);
  } catch (unknownError) {
    const error = toError(unknownError);
    return { tag: "ReadError", error };
  }
  return buffer.equals(versionedIdentifier)
    ? { tag: "NotNeeded" }
    : { tag: "Needed" };
}

async function postprocessHelper({
  env,
  logger,
  getNow,
  runMode,
  elmWatchJsonPath,
  outputPath,
  outputState,
  index,
  total,
  postprocessArray,
  postprocessWorkerPool,
  code,
  elmCompiledTimestamp,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunModeWithExtraData;
  elmWatchJsonPath: ElmWatchJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
  postprocessArray: NonEmptyArray<string>;
  postprocessWorkerPool: PostprocessWorkerPool;
  code: Buffer | string;
  elmCompiledTimestamp: number;
}): Promise<HandleOutputActionResult> {
  const startTimestamp = getNow().getTime();

  const updateStatusLineHelper = (): void => {
    updateStatusLine({
      logger,
      runMode: runMode.tag,
      outputPath,
      outputState,
      index,
      total,
    });
  };

  const { promise, kill } = runPostprocess({
    env,
    elmWatchJsonPath,
    compilationMode: outputState.compilationMode,
    runMode: runMode.tag,
    outputPath,
    postprocessArray,
    postprocessWorkerPool,
    code,
  });

  outputState.status = {
    tag: "Postprocess",
    kill,
    durations: appendDuration(
      outputState,
      outputState.status.tag === "QueuedForPostprocess"
        ? [
            {
              tag: "QueuedForPostprocess",
              durationMs:
                startTimestamp - outputState.status.elmCompiledTimestamp,
            },
          ]
        : []
    ),
  };
  updateStatusLineHelper();

  let postprocessResult;

  try {
    postprocessResult = await promise;
  } catch (unknownError) {
    if (unknownError === SPAWN_KILLED || unknownError === WORKER_TERMINATED) {
      outputState.dirty = true;
      outputState.status = { tag: "Interrupted" };
      updateStatusLineHelper();
      return { tag: "Nothing" };
    }
    throw unknownError;
  }

  if (outputState.dirty) {
    outputState.status = { tag: "Interrupted" };
    updateStatusLineHelper();
    return { tag: "Nothing" };
  }

  if (postprocessResult.tag === "Success") {
    try {
      switch (runMode.tag) {
        case "make":
          fs.writeFileSync(
            outputPath.theOutputPath.absolutePath,
            postprocessResult.code
          );
          break;
        case "hot":
          fs.writeFileSync(
            outputPath.theOutputPath.absolutePath,
            Buffer.concat([
              Buffer.from(
                Inject.clientCode(
                  outputPath,
                  elmCompiledTimestamp,
                  outputState.compilationMode,
                  runMode.webSocketPort
                )
              ),
              postprocessResult.code,
            ])
          );
          break;
      }
    } catch (unknownError) {
      const error = toError(unknownError);
      outputState.status = {
        tag: "WriteOutputError",
        error,
        reasonForWriting: "Postprocess",
      };
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };
    }
    outputState.status = {
      tag: "Success",
      elmFileSize: Buffer.byteLength(code),
      postprocessFileSize: postprocessResult.code.byteLength,
      elmCompiledTimestamp,
      durations: appendDuration(outputState, [
        {
          tag: "Postprocess",
          durationMs: getNow().getTime() - startTimestamp,
        },
      ]),
    };
    updateStatusLineHelper();
    return {
      tag: "FullyCompiledJS",
      outputPath,
      code: postprocessResult.code,
      elmCompiledTimestamp,
      compilationMode: outputState.compilationMode,
    };
  }

  outputState.status = postprocessResult;
  updateStatusLineHelper();
  return { tag: "CompileError", outputPath };
}

async function typecheck({
  env,
  logger,
  getNow,
  runMode,
  elmJsonPath,
  outputs,
  total,
  webSocketPort,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunMode;
  elmJsonPath: ElmJsonPath;
  outputs: NonEmptyArray<{
    index: number;
    outputPath: OutputPath;
    outputState: OutputState;
  }>;
  total: number;
  webSocketPort: Port;
}): Promise<void> {
  const startTimestamp = getNow().getTime();

  for (const { index, outputPath, outputState } of outputs) {
    outputState.dirty = false;
    outputState.status = {
      tag: "ElmMakeTypecheckOnly",
      durations:
        outputState.status.tag === "QueuedForElmMake"
          ? [
              {
                tag: "QueuedForElmMake",
                durationMs: startTimestamp - outputState.status.startTimestamp,
              },
            ]
          : [],
    };
    updateStatusLine({
      logger,
      runMode,
      outputPath,
      outputState,
      index,
      total,
    });
  }

  const [elmMakeResult, allRelatedElmFilePathsResults] = await Promise.all([
    SpawnElm.make({
      elmJsonPath,
      compilationMode: "standard",
      // Mentioning the same input twice is an error according to `elm make`.
      // It even resolves symlinks when checking if two inputs are the same!
      inputs: nonEmptyArrayUniqueBy(
        (inputPath) => inputPath.realpath.absolutePath,
        flattenNonEmptyArray(
          mapNonEmptyArray(outputs, ({ outputState }) => outputState.inputs)
        )
      ),
      outputPath: { tag: "NullOutputPath" },
      env,
    }).then(
      (result): WithDuration<SpawnElm.RunElmMakeResult> => ({
        ...result,
        durationMs: getNow().getTime() - startTimestamp,
      })
    ),
    Promise.resolve().then(() =>
      mapNonEmptyArray(
        outputs,
        (
          output
        ): {
          index: number;
          outputPath: OutputPath;
          outputState: OutputState;
          allRelatedElmFilePathsResult: WithDuration<GetAllRelatedElmFilePathsResult>;
        } => ({
          ...output,
          allRelatedElmFilePathsResult: {
            ...getAllRelatedElmFilePaths(
              elmJsonPath,
              output.outputState.inputs
            ),
            durationMs: getNow().getTime() - startTimestamp,
          },
        })
      )
    ),
  ]);

  const isAmbiguousError =
    elmMakeResult.tag === "ElmMakeError" &&
    elmMakeResult.error.tag === "GeneralError" &&
    elmMakeResult.error.path.tag === "NoPath";

  const promises: Array<Promise<void>> = [];

  for (const {
    index,
    outputPath,
    outputState,
    allRelatedElmFilePathsResult,
  } of allRelatedElmFilePathsResults) {
    if (outputState.dirty) {
      outputState.status = { tag: "Interrupted" };
      updateStatusLine({
        logger,
        runMode,
        outputPath,
        outputState,
        index,
        total,
      });
      continue;
    }

    // If we don’t know which targets the error is for, we need to re-run the
    // typechecking individually. This is rare.
    if (isAmbiguousError) {
      promises.push(
        typecheck({
          env,
          logger,
          getNow,
          runMode,
          elmJsonPath,
          outputs: [{ index, outputPath, outputState }],
          total,
          webSocketPort,
        })
      );
      continue;
    }

    outputState.allRelatedElmFilePaths = allRelatedElmFilePathsWithFallback(
      allRelatedElmFilePathsResult,
      outputState
    );

    const combinedResult = combineResults(
      {
        ...onlyElmMakeErrorsRelatedToOutput(outputState, elmMakeResult),
        durationMs: elmMakeResult.durationMs,
      },
      allRelatedElmFilePathsResult
    );

    switch (combinedResult.tag) {
      case "elm make success + walker success": {
        const duration: Duration = {
          tag: "ElmMakeTypecheckOnly",
          elmDurationMs: combinedResult.elmDurationMs,
          walkerDurationMs: combinedResult.walkerDurationMs,
        };

        const result = needsToWriteProxyFile(
          outputPath.theOutputPath,
          Buffer.from(Inject.versionedIdentifier(webSocketPort))
        );

        switch (result.tag) {
          case "Needed":
            try {
              fs.mkdirSync(
                absoluteDirname(outputPath.theOutputPath).absolutePath,
                { recursive: true }
              );
              fs.writeFileSync(
                outputPath.theOutputPath.absolutePath,
                Inject.proxyFile(outputPath, getNow().getTime(), webSocketPort)
              );
              // The proxy file doesn’t count as writing to disk…
              outputState.status = {
                tag: "NotWrittenToDisk",
                durations: appendDuration(outputState, [duration]),
              };
            } catch (unknownError) {
              const error = toError(unknownError);
              outputState.status = { tag: "WriteProxyOutputError", error };
            }
            break;

          case "NotNeeded":
            outputState.status = {
              tag: "NotWrittenToDisk",
              durations: appendDuration(outputState, [duration]),
            };
            break;

          case "ReadError":
            outputState.status = {
              tag: "ReadOutputError",
              error: result.error,
            };
            break;
        }

        break;
      }

      case "elm make success + walker failure":
        outputState.status = combinedResult.walkerError;
        break;

      case "elm make failure + walker success":
        outputState.status = combinedResult.elmMakeError;
        break;

      case "elm make failure + walker failure":
        // If `elm make` failed, don’t bother with `getAllRelatedElmFilePaths` errors.
        outputState.status = combinedResult.elmMakeError;
        break;
    }

    updateStatusLine({
      logger,
      runMode,
      outputPath,
      outputState,
      index,
      total,
    });
  }

  await Promise.all(promises);
}

function onlyElmMakeErrorsRelatedToOutput(
  outputState: OutputState,
  elmMakeResult: SpawnElm.RunElmMakeResult
): SpawnElm.RunElmMakeResult {
  if (
    !(
      elmMakeResult.tag === "ElmMakeError" &&
      elmMakeResult.error.tag === "CompileErrors"
    )
  ) {
    return elmMakeResult;
  }

  const errors = elmMakeResult.error.errors.filter((error) =>
    outputState.allRelatedElmFilePaths.has(error.path.absolutePath)
  );

  return isNonEmptyArray(errors)
    ? { tag: "ElmMakeError", error: { tag: "CompileErrors", errors } }
    : { tag: "Success" };
}

type CombinedResult =
  | {
      tag: "elm make failure + walker failure";
      elmMakeError: SpawnElm.RunElmMakeError;
      walkerError: GetAllRelatedElmFilePathsError;
    }
  | {
      tag: "elm make failure + walker success";
      elmMakeError: SpawnElm.RunElmMakeError;
      allRelatedElmFilePaths: Set<string>;
    }
  | {
      tag: "elm make success + walker failure";
      walkerError: GetAllRelatedElmFilePathsError;
    }
  | {
      tag: "elm make success + walker success";
      allRelatedElmFilePaths: Set<string>;
      elmDurationMs: number;
      walkerDurationMs: number;
    };

function combineResults(
  elmMakeResult: WithDuration<SpawnElm.RunElmMakeResult>,
  allRelatedElmFilePathsResult: WithDuration<GetAllRelatedElmFilePathsResult>
): CombinedResult {
  switch (elmMakeResult.tag) {
    case "Success":
      switch (allRelatedElmFilePathsResult.tag) {
        case "Success":
          return {
            tag: "elm make success + walker success",
            allRelatedElmFilePaths:
              allRelatedElmFilePathsResult.allRelatedElmFilePaths,
            elmDurationMs: elmMakeResult.durationMs,
            walkerDurationMs: allRelatedElmFilePathsResult.durationMs,
          };

        default:
          return {
            tag: "elm make success + walker failure",
            walkerError: allRelatedElmFilePathsResult,
          };
      }

    default:
      switch (allRelatedElmFilePathsResult.tag) {
        case "Success":
          return {
            tag: "elm make failure + walker success",
            elmMakeError: elmMakeResult,
            allRelatedElmFilePaths:
              allRelatedElmFilePathsResult.allRelatedElmFilePaths,
          };

        default:
          return {
            tag: "elm make failure + walker failure",
            elmMakeError: elmMakeResult,
            walkerError: allRelatedElmFilePathsResult,
          };
      }
  }
}

// This allows us to _always_ move the cursor in `updateStatusLine`, even the
// “first” time which makes everything so much simpler.
export function printSpaceForOutputs(
  logger: Logger,
  runMode: RunMode,
  outputActions: OutputActions
): void {
  if (!logger.raw.stderr.isTTY) {
    return;
  }
  if (isNonEmptyArray(outputActions.outputsWithoutAction)) {
    for (let index = 0; index < outputActions.total; index++) {
      const output = outputActions.outputsWithoutAction.find(
        (output2) => output2.index === index
      );
      if (output === undefined) {
        logger.raw.stderr.write("\n");
      } else {
        logger.error(
          statusLine({
            runMode,
            outputPath: output.outputPath,
            outputState: output.outputState,
            maxWidth: logger.raw.stderrColumns,
            fancy: logger.fancy,
            isTTY: logger.raw.stderr.isTTY,
          })
        );
      }
    }
  } else {
    logger.raw.stderr.write("\n".repeat(outputActions.total));
  }
}

function updateStatusLine({
  logger,
  runMode,
  outputPath,
  outputState,
  index,
  total,
}: {
  logger: Logger;
  runMode: RunMode;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
}): void {
  const shouldMoveCursor = logger.raw.stderr.isTTY;
  if (shouldMoveCursor) {
    readline.moveCursor(logger.raw.stderr, 0, -total + index);
    readline.clearLine(logger.raw.stderr, 0);
  }
  logger.error(
    statusLine({
      runMode,
      outputPath,
      outputState,
      maxWidth: logger.raw.stderrColumns,
      fancy: logger.fancy,
      isTTY: logger.raw.stderr.isTTY,
    })
  );
  if (shouldMoveCursor) {
    readline.moveCursor(logger.raw.stderr, 0, total - index - 1);
  }
}

export type EmojiName = keyof typeof EMOJI;

export const EMOJI = {
  QueuedForElmMake: {
    emoji: "⚪️",
    description: "queued for elm make",
  },
  QueuedForPostprocess: {
    emoji: "🟢",
    description: "elm make done – queued for postprocess",
  },
  Busy: {
    emoji: "⏳",
    description: "elm make or postprocess",
  },
  Error: {
    emoji: "🚨",
    description: "error",
  },
  Skipped: {
    emoji: "⛔️",
    description: "skipped",
  },
  Success: {
    emoji: "✅",
    description: "success",
  },
  Information: {
    emoji: "ℹ️",
    description: "information",
  },
};

export function emojiWidthFix({
  emoji,
  column,
  isTTY,
}: {
  emoji: string;
  column: number;
  isTTY: boolean;
}): string {
  // Emojis take two terminal columns. At least iTerm sometimes messes up and
  // renders the emoji in full width, but overlaps the next character instead of
  // using two columns of space. We can help it by manually moving the cursor to
  // the intended position. Note: This assumes that we render the emoji at the
  // beginning of a line.
  return `${emoji}${isTTY ? cursorHorizontalAbsolute(column) : ""}`;
}

export function printStatusLinesForElmJsonsErrors(
  logger: Logger,
  project: Project
): void {
  const { isTTY } = logger.raw.stderr;
  for (const { outputPath } of project.elmJsonsErrors) {
    const { targetName } = outputPath;
    logger.error(
      printStatusLine({
        maxWidth: logger.raw.stderrColumns,
        fancy: logger.fancy,
        isTTY,
        emojiName: "Error",
        string: logger.fancy ? targetName : `${targetName}: error`,
      })
    );
  }
}

export function printErrors(
  logger: Logger,
  errors: NonEmptyArray<Errors.ErrorTemplate>
): void {
  const errorStrings = Array.from(
    new Set(errors.map((template) => template(logger.raw.stderrColumns)))
  );

  logger.error("");
  logger.error(join(errorStrings, "\n\n"));
  logger.error("");
  printNumErrors(logger, errorStrings.length);
}

export function printNumErrors(logger: Logger, numErrors: number): void {
  logger.error(
    printStatusLine({
      maxWidth: logger.raw.stderrColumns,
      fancy: logger.fancy,
      isTTY: logger.raw.stderr.isTTY,
      emojiName: "Error",
      string: `${bold(numErrors.toString())} error${
        numErrors === 1 ? "" : "s"
      } found`,
    })
  );
}

function statusLine({
  runMode,
  outputPath,
  outputState,
  maxWidth,
  fancy,
  isTTY,
}: {
  runMode: RunMode;
  outputPath: OutputPath;
  outputState: OutputState;
  maxWidth: number;
  fancy: boolean;
  isTTY: boolean;
}): string {
  const { targetName } = outputPath;
  const { status } = outputState;

  const helper = (emojiName: EmojiName, string: string): string =>
    printStatusLine({
      maxWidth,
      fancy,
      isTTY,
      emojiName,
      string,
    });

  const withExtraDetailsAtEnd = (
    extra: Array<string | undefined>,
    emojiName: EmojiName,
    start: string
  ): string => {
    const strings = extra.flatMap((item) => (item === undefined ? [] : item));
    if (!isNonEmptyArray(strings)) {
      return "";
    }

    // Emojis take two terminal columns, plus a space that we add after.
    const startLength = fancy ? start.length + 3 : start.length;
    const end = join(strings, "   ");
    const max = Math.min(maxWidth, 100);
    const padding = isTTY ? Math.max(3, max - end.length - startLength) : 3;

    // The `\0` business is a clever way of truncating without messing up the
    // `dim` color.
    return helper(
      emojiName,
      `${start}\0${" ".repeat(padding - 1)}${end}`
    ).replace(/\0(.*)$/, dim(" $1"));
  };

  switch (status.tag) {
    case "NotWrittenToDisk": {
      return withExtraDetailsAtEnd(
        [maybePrintDurations(status.durations, fancy)],
        "Success",
        fancy ? targetName : `${targetName}: success`
      );
    }

    case "Success": {
      return withExtraDetailsAtEnd(
        [
          maybePrintFileSize(
            runMode,
            outputState.compilationMode,
            status.elmFileSize,
            status.postprocessFileSize,
            fancy
          ),
          maybePrintDurations(status.durations, fancy),
        ],
        "Success",
        fancy ? targetName : `${targetName}: success`
      );
    }

    case "ElmMake": {
      const arg = SpawnElm.compilationModeToArg(status.compilationMode);
      const flags = arg === undefined ? "" : ` ${arg}`;
      return helper("Busy", `${targetName}: elm make${flags}`);
    }

    case "ElmMakeTypecheckOnly":
      return helper("Busy", `${targetName}: elm make (typecheck only)`);

    case "Postprocess":
      return helper("Busy", `${targetName}: postprocess`);

    case "Interrupted":
      return helper("Busy", `${targetName}: interrupted`);

    case "QueuedForElmMake":
      return helper("QueuedForElmMake", `${targetName}: queued`);

    case "QueuedForPostprocess":
      return helper("QueuedForPostprocess", `${targetName}: elm make done`);

    case "ElmNotFoundError":
    case "CommandNotFoundError":
    case "OtherSpawnError":
    case "UnexpectedElmMakeOutput":
    case "PostprocessStdinWriteError":
    case "PostprocessNonZeroExit":
    case "ElmWatchNodeMissingScript":
    case "ElmWatchNodeImportError":
    case "ElmWatchNodeDefaultExportNotFunction":
    case "ElmWatchNodeRunError":
    case "ElmWatchNodeBadReturnValue":
    case "ElmMakeJsonParseError":
    case "ElmMakeError":
    case "ElmJsonReadAsJsonError":
    case "ElmJsonDecodeError":
    case "ImportWalkerFileSystemError":
    case "ReadOutputError":
    case "WriteOutputError":
    case "WriteProxyOutputError":
    case "InjectSearchAndReplaceNotFound":
      return helper("Error", fancy ? targetName : `${targetName}: error`);
  }
}

function printStatusLine({
  maxWidth,
  fancy,
  isTTY,
  emojiName,
  string,
}: {
  maxWidth: number;
  fancy: boolean;
  isTTY: boolean;
  emojiName: EmojiName;
  string: string;
}): string {
  // Emojis take two terminal columns. At least iTerm sometimes messes up and
  // renders the emoji in full width, but overlaps the next character instead of
  // using two columns of space. We can help it by manually moving the cursor to
  // the intended position. Note: This assumes that we render the emoji at the
  // beginning of a line.
  const emojiString = emojiWidthFix({
    emoji: EMOJI[emojiName].emoji,
    column: 3,
    isTTY,
  });

  const stringWithEmoji = fancy ? `${emojiString} ${string}` : string;

  if (!isTTY) {
    return stringWithEmoji;
  }

  // Emojis take two terminal columns, plus a space that we add after.
  const length = fancy ? string.length + 3 : string.length;
  return length <= maxWidth
    ? stringWithEmoji
    : fancy
    ? // Again, account for the emoji.
      `${emojiString} ${string.slice(0, maxWidth - 4)}…`
    : `${string.slice(0, maxWidth - 3)}...`;
}

function maybePrintFileSize(
  runMode: RunMode,
  compilationMode: CompilationMode,
  elmFileSize: number,
  postprocessFileSize: number,
  fancy: boolean
): string | undefined {
  switch (runMode) {
    case "make":
      switch (compilationMode) {
        case "debug":
        case "standard":
          return undefined;

        case "optimize":
          return postprocessFileSize === elmFileSize
            ? printFileSize(elmFileSize)
            : `${printFileSize(elmFileSize)} ${
                fancy ? "→" : "->"
              } ${printFileSize(postprocessFileSize)} (${(
                (postprocessFileSize / elmFileSize) *
                100
              ).toFixed(1)}%)`;
      }

    case "hot":
      return undefined;
  }
}

const KiB = 1024;
const MiB = KiB ** 2;

function printFileSize(fileSize: number): string {
  const [divided, unit] =
    fileSize >= MiB ? [fileSize / MiB, "MiB"] : [fileSize / KiB, "KiB"];
  const string = divided
    .toFixed(divided < 10 ? 2 : divided < 100 ? 1 : 0)
    .padStart(4, " ");
  return `${string} ${unit}`;
}

const SECOND = 1000;

function printDurationMs(durationMs: number): string {
  const divided = durationMs / SECOND;
  const [string, unit] =
    durationMs < SECOND
      ? [durationMs.toString(), "ms"]
      : [divided.toFixed(divided < 10 ? 1 : 0), "s"];
  return `${string.padStart(3, " ")} ${unit}`;
}

function maybePrintDurations(
  durations: Array<Duration>,
  fancy: boolean
): string | undefined {
  if (!isNonEmptyArray(durations)) {
    return undefined;
  }

  const newDurations: NonEmptyArray<Duration> = durations.some(
    (duration) => duration.tag === "QueuedForElmMake"
  )
    ? durations
    : [{ tag: "QueuedForElmMake", durationMs: 0 }, ...durations];

  return join(
    mapNonEmptyArray(newDurations, (duration) =>
      printDuration(duration, fancy)
    ),
    " | "
  );
}

function printDuration(duration: Duration, fancy: boolean): string {
  switch (duration.tag) {
    case "QueuedForElmMake":
      return `${printDurationMs(duration.durationMs)} Q`;

    case "ElmMake":
    case "ElmMakeTypecheckOnly":
      return `${printDurationMs(duration.elmDurationMs)} ${
        duration.tag === "ElmMake" ? "E" : "T"
      }${
        duration.walkerDurationMs === -1
          ? ""
          : ` ${fancy ? "¦" : "/"} ${printDurationMs(
              duration.walkerDurationMs
            )} W`
      }`;

    case "Inject":
      return `${printDurationMs(duration.durationMs)} I`;

    case "QueuedForPostprocess":
      return `${printDurationMs(duration.durationMs)} R`;

    case "Postprocess":
      return `${printDurationMs(duration.durationMs)} P`;
  }
}

export function extractErrors(project: Project): Array<Errors.ErrorTemplate> {
  return [
    ...project.elmJsonsErrors.map(({ outputPath, error }) => {
      switch (error.tag) {
        case "ElmJsonNotFound":
          return Errors.elmJsonNotFound(
            outputPath,
            error.elmJsonNotFound,
            error.foundElmJsonPaths
          );

        case "NonUniqueElmJsonPaths":
          return Errors.nonUniqueElmJsonPaths(
            outputPath,
            error.nonUniqueElmJsonPaths
          );

        case "InputsNotFound":
          return Errors.inputsNotFound(outputPath, error.inputsNotFound);

        case "InputsFailedToResolve":
          return Errors.inputsFailedToResolve(
            outputPath,
            error.inputsFailedToResolve
          );

        case "DuplicateInputs":
          return Errors.duplicateInputs(outputPath, error.duplicates);
      }
    }),

    ...Array.from(project.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs).flatMap(([outputPath, { status }]) => {
        switch (status.tag) {
          case "NotWrittenToDisk":
            return [];

          case "ElmMake":
          case "ElmMakeTypecheckOnly":
          case "Postprocess":
          case "Interrupted":
          case "QueuedForElmMake":
            return Errors.stuckInProgressState(outputPath, status.tag);

          // If there are `elm make` errors we skip postprocessing (fail fast).
          case "QueuedForPostprocess":
            return [];

          case "Success":
            return [];

          // istanbul ignore next
          case "ElmNotFoundError":
            return Errors.elmNotFoundError(outputPath, status.command);

          case "CommandNotFoundError":
            return Errors.commandNotFoundError(outputPath, status.command);

          // istanbul ignore next
          case "OtherSpawnError":
            return Errors.otherSpawnError(
              outputPath,
              status.error,
              status.command
            );

          case "UnexpectedElmMakeOutput":
            return Errors.unexpectedElmMakeOutput(
              outputPath,
              status.exitReason,
              status.stdout,
              status.stderr,
              status.command
            );

          case "PostprocessStdinWriteError":
            return Errors.postprocessStdinWriteError(
              outputPath,
              status.error,
              status.command
            );

          case "PostprocessNonZeroExit":
            return Errors.postprocessNonZeroExit(
              outputPath,
              status.exitReason,
              status.stdout,
              status.stderr,
              status.command
            );

          case "ElmWatchNodeMissingScript":
            return Errors.elmWatchNodeMissingScript(project.elmWatchJsonPath);

          case "ElmWatchNodeImportError":
            return Errors.elmWatchNodeImportError(
              status.scriptPath,
              status.error,
              status.stdout,
              status.stderr
            );

          case "ElmWatchNodeDefaultExportNotFunction":
            return Errors.elmWatchNodeDefaultExportNotFunction(
              status.scriptPath,
              status.imported,
              status.typeofDefault,
              status.stdout,
              status.stderr
            );

          case "ElmWatchNodeRunError":
            return Errors.elmWatchNodeRunError(
              status.scriptPath,
              status.args,
              status.error,
              status.stdout,
              status.stderr
            );

          case "ElmWatchNodeBadReturnValue":
            return Errors.elmWatchNodeBadReturnValue(
              status.scriptPath,
              status.args,
              status.returnValue,
              status.stdout,
              status.stderr
            );

          case "ElmMakeJsonParseError":
            return Errors.elmMakeJsonParseError(
              outputPath,
              status.error,
              status.errorFilePath,
              status.command
            );

          case "ElmMakeError":
            switch (status.error.tag) {
              case "GeneralError":
                return ElmMakeError.renderGeneralError(
                  outputPath,
                  elmJsonPath,
                  status.error
                );

              case "CompileErrors":
                return status.error.errors.flatMap((error) =>
                  error.problems.map((problem) =>
                    ElmMakeError.renderProblem(error.path, problem)
                  )
                );
            }

          case "ElmJsonReadAsJsonError":
            return Errors.readElmJsonAsJson(status.elmJsonPath, status.error);

          case "ElmJsonDecodeError":
            return Errors.decodeElmJson(status.elmJsonPath, status.error);

          case "ImportWalkerFileSystemError":
            return Errors.importWalkerFileSystemError(outputPath, status.error);

          case "ReadOutputError":
            return Errors.readOutputError(outputPath, status.error);

          case "WriteOutputError":
            return Errors.writeOutputError(
              outputPath,
              status.error,
              status.reasonForWriting
            );

          case "WriteProxyOutputError":
            return Errors.writeProxyOutputError(outputPath, status.error);

          case "InjectSearchAndReplaceNotFound":
            return Errors.injectSearchAndReplaceNotFound(
              outputPath,
              status.errorFilePath
            );
        }
      })
    ),
  ];
}

type GetAllRelatedElmFilePathsResult = ElmJson.ParseError | WalkImportsResult;
type GetAllRelatedElmFilePathsError = ElmJson.ParseError | WalkImportsError;

function getAllRelatedElmFilePaths(
  elmJsonPath: ElmJsonPath,
  inputs: NonEmptyArray<InputPath>
): GetAllRelatedElmFilePathsResult {
  const parseResult = ElmJson.readAndParse(elmJsonPath);

  switch (parseResult.tag) {
    case "Parsed":
      return walkImports(
        ElmJson.getSourceDirectories(elmJsonPath, parseResult.elmJson),
        inputs
      );

    default:
      return parseResult;
  }
}

function allRelatedElmFilePathsWithFallback(
  walkerResult: GetAllRelatedElmFilePathsResult,
  outputState: OutputState
): Set<string> {
  switch (walkerResult.tag) {
    case "Success":
      return walkerResult.allRelatedElmFilePaths;

    case "ImportWalkerFileSystemError":
      return walkerResult.relatedElmFilePathsUntilError;

    case "ElmJsonReadAsJsonError":
    case "ElmJsonDecodeError":
      return new Set(
        mapNonEmptyArray(
          outputState.inputs,
          (inputPath) => inputPath.realpath.absolutePath
        )
      );
  }
}

function appendDuration(
  outputState: OutputState,
  durations: Array<Duration>
): Array<Duration> {
  const previousDurations =
    "durations" in outputState.status ? outputState.status.durations : [];
  return [...previousDurations, ...durations];
}
