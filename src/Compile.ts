import * as fs from "fs";
import * as readline from "readline";

import * as ElmJson from "./ElmJson";
import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { HashMap } from "./HashMap";
import {
  bold,
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
import { Logger } from "./Logger";
import {
  flattenNonEmptyArray,
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
  nonEmptyArrayUniqueBy,
} from "./NonEmptyArray";
import { absoluteDirname, AbsolutePath } from "./PathHelpers";
import { Postprocess, runPostprocess } from "./Postprocess";
import { OutputError, OutputState, Project } from "./Project";
import * as SpawnElm from "./SpawnElm";
import {
  CompilationMode,
  ElmJsonPath,
  ElmWatchJsonPath,
  GetNow,
  InputPath,
  OutputPath,
  RunMode,
} from "./Types";

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

  const elmJsonsArray = Array.from(project.elmJsons);

  for (const [index, [elmJsonPath]] of elmJsonsArray.entries()) {
    // Don’t print `(x/y)` the first time, because chances are all packages are
    // downloaded via the first elm.json and that looks nicer.
    const message = `Dependencies${
      index === 0 ? "" : ` (${index + 1}/${elmJsonsArray.length})`
    }`;

    const loadingMessage = logger.fancy
      ? `⏳ ${message}`
      : `${message}: in progress`;

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
      logger.error(logger.fancy ? `🚨 ${message}` : `${message}: error`);
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
          logger.error(logger.fancy ? `⛔️ ${message}` : `${message}: skipped`);
        }
        break;

      case "Success": {
        const gotOutput = result.elmInstallOutput !== "";
        if (didWriteLoadingMessage || gotOutput) {
          clearLoadingMessage();
          logger.error(logger.fancy ? `✅ ${message}` : `${message}: success`);
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
    }
  | {
      tag: "Nothing";
    };

type RunModeWithVersionedIdentifier =
  | {
      tag: "hot";
      versionedIdentifier: Buffer;
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
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunModeWithVersionedIdentifier;
  elmWatchJsonPath: ElmWatchJsonPath;
  total: number;
  action: OutputAction;
  postprocess: Postprocess;
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
            elmJsonPath: action.elmJsonPath,
            outputs: mapNonEmptyArray(action.outputs, ({ output }) => output),
            total,
            versionedIdentifier: runMode.versionedIdentifier,
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
        code: action.code,
      });

    case "QueueForElmMake":
      action.output.outputState.status = { tag: "QueuedForElmMake" };
      updateStatusLine({
        logger,
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
  runMode: RunModeWithVersionedIdentifier;
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
  postprocess: Postprocess;
}): Promise<HandleOutputActionResult> {
  const updateStatusLineHelper = (): void => {
    updateStatusLine({
      logger,
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
  };
  updateStatusLineHelper();
  const [elmMakeResult, allRelatedElmFilePathsResult] = await Promise.all([
    SpawnElm.make({
      elmJsonPath,
      compilationMode: outputState.compilationMode,
      inputs: outputState.inputs,
      outputPath,
      env,
    }),
    Promise.resolve().then((): GetAllRelatedElmFilePathsResult => {
      switch (runMode.tag) {
        case "make":
          return {
            tag: "Success",
            allRelatedElmFilePaths: outputState.allRelatedElmFilePaths,
          };
        case "hot":
          // Note: It doesn’t matter if a file changes before we’ve had
          // chance to compute this the first time (during packages
          // installation or `elm make` above). Everything is marked as
          // dirty by default anyway and will get compiled.
          return getAllRelatedElmFilePaths(elmJsonPath, outputState.inputs);
      }
    }),
  ]);

  if (outputState.dirty) {
    outputState.status = { tag: "Interrupted" };
    updateStatusLineHelper();
    return { tag: "Nothing" };
  }

  const combinedResult = combineResults(
    elmMakeResult,
    allRelatedElmFilePathsResult
  );

  switch (combinedResult.tag) {
    case "elm make success + walker success":
      outputState.allRelatedElmFilePaths =
        combinedResult.allRelatedElmFilePaths;
      return onCompileSuccess(
        updateStatusLineHelper,
        runMode,
        outputPath,
        outputState,
        getNow().getTime(),
        postprocess
      );

    case "elm make success + walker failure":
      outputState.allRelatedElmFilePaths = fallbackAllRelatedElmFilePaths(
        combinedResult.walkerError,
        outputState
      );
      outputState.status = combinedResult.walkerError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };

    case "elm make failure + walker success":
      outputState.allRelatedElmFilePaths =
        combinedResult.allRelatedElmFilePaths;
      outputState.status = combinedResult.elmMakeError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };

    case "elm make failure + walker failure":
      outputState.allRelatedElmFilePaths = fallbackAllRelatedElmFilePaths(
        combinedResult.walkerError,
        outputState
      );
      // If `elm make` failed, don’t bother with `getAllRelatedElmFilePaths` errors.
      outputState.status = combinedResult.elmMakeError;
      updateStatusLineHelper();
      return { tag: "CompileError", outputPath };
  }
}

function onCompileSuccess(
  updateStatusLineHelper: () => void,
  runMode: RunModeWithVersionedIdentifier,
  outputPath: OutputPath,
  outputState: OutputState,
  compiledTimestamp: number,
  postprocess: Postprocess
): HandleOutputActionResult {
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
            fileSize,
            compiledTimestamp,
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

      const result = injectWebSocketClient(buffer.toString("utf8"));

      switch (result.tag) {
        case "Error":
          // outputState.status = { tag: "TODO" };
          updateStatusLineHelper();
          return { tag: "CompileError", outputPath };

        case "Success":
          switch (postprocess.tag) {
            case "NoPostprocess": {
              const newBuffer = Buffer.from(result.code);
              try {
                fs.writeFileSync(
                  outputPath.theOutputPath.absolutePath,
                  Buffer.concat([runMode.versionedIdentifier, newBuffer])
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
                fileSize: newBuffer.byteLength,
                compiledTimestamp,
              };
              updateStatusLineHelper();
              return {
                tag: "FullyCompiledJS",
                outputPath,
                code: newBuffer,
              };
            }

            case "Postprocess": {
              outputState.status = {
                tag: "QueuedForPostprocess",
                postprocessArray: postprocess.postprocessArray,
                code: result.code,
              };
              updateStatusLineHelper();
              return { tag: "Nothing" };
            }
          }
      }
    }
  }
}

type InjectWebSocketClientResult =
  | {
      tag: "Error";
    }
  | {
      tag: "Success";
      code: string;
    };

function injectWebSocketClient(code: string): InjectWebSocketClientResult {
  // TODO: Implement!
  return { tag: "Success", code };
}

function proxyFile(): Buffer {
  // First char lowercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L296-L300
  // First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
  // Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
  // https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
  const lowerName = /^\p{Ll}[_\d\p{L}]*$/u;
  const upperName = /^\p{Lu}[_\d\p{L}]*$/u;

  const stub = (_: unknown): void => undefined;

  const portsProxy = (): Record<string, never> =>
    new Proxy(
      {},
      {
        get: (target, property, receiver) =>
          Reflect.has(target, property) ||
          typeof property === "symbol" ||
          !lowerName.test(property)
            ? (Reflect.get(target, property, receiver) as unknown)
            : { send: stub, subscribe: stub, unsubscribe: stub },
        has: (target, property) =>
          Reflect.has(target, property) ||
          typeof property === "symbol" ||
          !lowerName.test(property)
            ? Reflect.has(target, property)
            : true,
      }
    );

  const moduleProxy = (): unknown =>
    new Proxy(
      { init: (_: unknown) => ({ ports: portsProxy() }) },
      {
        get: (target, property, receiver) =>
          Reflect.has(target, property) ||
          typeof property === "symbol" ||
          !upperName.test(property)
            ? (Reflect.get(target, property, receiver) as unknown)
            : moduleProxy(),
        has: (target, property) =>
          Reflect.has(target, property) ||
          typeof property === "symbol" ||
          !upperName.test(property)
            ? Reflect.has(target, property)
            : true,
      }
    );

  return Buffer.from("TODO");
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
  code,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  runMode: RunModeWithVersionedIdentifier;
  elmWatchJsonPath: ElmWatchJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
  postprocessArray: NonEmptyArray<string>;
  code: Buffer | string;
}): Promise<HandleOutputActionResult> {
  const updateStatusLineHelper = (): void => {
    updateStatusLine({
      logger,
      outputPath,
      outputState,
      index,
      total,
    });
  };

  outputState.status = { tag: "Postprocess" };
  updateStatusLineHelper();

  const postprocessResult = await runPostprocess({
    env,
    elmWatchJsonPath,
    compilationMode: outputState.compilationMode,
    runMode: runMode.tag,
    outputPath,
    postprocessArray,
    code,
  });

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
            Buffer.concat([runMode.versionedIdentifier, postprocessResult.code])
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
      fileSize: postprocessResult.code.byteLength,
      compiledTimestamp: getNow().getTime(),
    };
    updateStatusLineHelper();
    return {
      tag: "FullyCompiledJS",
      outputPath,
      code: postprocessResult.code,
    };
  }

  outputState.status = postprocessResult;
  updateStatusLineHelper();
  return { tag: "CompileError", outputPath };
}

async function typecheck({
  env,
  logger,
  elmJsonPath,
  outputs,
  total,
  versionedIdentifier,
}: {
  env: Env;
  logger: Logger;
  elmJsonPath: ElmJsonPath;
  outputs: NonEmptyArray<{
    index: number;
    outputPath: OutputPath;
    outputState: OutputState;
  }>;
  total: number;
  versionedIdentifier: Buffer;
}): Promise<void> {
  for (const { index, outputPath, outputState } of outputs) {
    outputState.dirty = false;
    outputState.status = { tag: "ElmMakeTypecheckOnly" };
    updateStatusLine({
      logger,
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
    }),
    Promise.resolve().then(() =>
      mapNonEmptyArray(outputs, (output) => ({
        ...output,
        allRelatedElmFilePathsResult: getAllRelatedElmFilePaths(
          elmJsonPath,
          output.outputState.inputs
        ),
      }))
    ),
  ]);

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
        outputPath,
        outputState,
        index,
        total,
      });
      continue;
    }

    const combinedResult = combineResults(
      elmMakeResult,
      allRelatedElmFilePathsResult
    );

    switch (combinedResult.tag) {
      case "elm make success + walker success": {
        outputState.allRelatedElmFilePaths =
          combinedResult.allRelatedElmFilePaths;

        const result = needsToWriteProxyFile(
          outputPath.theOutputPath,
          versionedIdentifier
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
                Buffer.concat([versionedIdentifier, proxyFile()])
              );
              // The proxy file doesn’t count as writing to disk…
              outputState.status = { tag: "NotWrittenToDisk" };
            } catch (unknownError) {
              const error = toError(unknownError);
              outputState.status = { tag: "WriteProxyOutputError", error };
            }
            break;

          case "NotNeeded":
            outputState.status = { tag: "NotWrittenToDisk" };
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
        outputState.allRelatedElmFilePaths = fallbackAllRelatedElmFilePaths(
          combinedResult.walkerError,
          outputState
        );
        outputState.status = combinedResult.walkerError;
        break;

      case "elm make failure + walker success":
        outputState.allRelatedElmFilePaths =
          combinedResult.allRelatedElmFilePaths;
        outputState.status = combinedResult.elmMakeError;
        break;

      case "elm make failure + walker failure":
        outputState.allRelatedElmFilePaths = fallbackAllRelatedElmFilePaths(
          combinedResult.walkerError,
          outputState
        );
        // If `elm make` failed, don’t bother with `getAllRelatedElmFilePaths` errors.
        outputState.status = combinedResult.elmMakeError;
        break;
    }

    updateStatusLine({
      logger,
      outputPath,
      outputState,
      index,
      total,
    });
  }
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
    };

function combineResults(
  elmMakeResult: SpawnElm.RunElmMakeResult,
  allRelatedElmFilePathsResult: GetAllRelatedElmFilePathsResult
): CombinedResult {
  switch (elmMakeResult.tag) {
    case "Success":
      switch (allRelatedElmFilePathsResult.tag) {
        case "Success":
          return {
            tag: "elm make success + walker success",
            allRelatedElmFilePaths:
              allRelatedElmFilePathsResult.allRelatedElmFilePaths,
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
          statusLine(
            output.outputPath,
            output.outputState,
            logger.raw.stderrColumns,
            logger.fancy
          )
        );
      }
    }
  } else {
    logger.raw.stderr.write("\n".repeat(outputActions.total));
  }
}

function updateStatusLine({
  logger,
  outputPath,
  outputState,
  index,
  total,
}: {
  logger: Logger;
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
    statusLine(outputPath, outputState, logger.raw.stderrColumns, logger.fancy)
  );
  if (shouldMoveCursor) {
    readline.moveCursor(logger.raw.stderr, 0, total - index - 1);
  }
}

export function printStatusLinesForElmJsonsErrors(
  logger: Logger,
  project: Project
): void {
  for (const { outputPath } of project.elmJsonsErrors) {
    const { targetName } = outputPath;
    logger.error(
      statusLineTruncate(
        logger.raw.stderrColumns,
        logger.fancy,
        logger.fancy ? `🚨 ${targetName}` : `${targetName}: error`
      )
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
  logger.error(
    `${logger.fancy ? "🚨 " : ""}${bold(errorStrings.length.toString())} error${
      errorStrings.length === 1 ? "" : "s"
    } found`
  );
}

function statusLine(
  outputPath: OutputPath,
  outputState: OutputState,
  maxWidth: number,
  fancy: boolean
): string {
  const { targetName } = outputPath;
  const { status } = outputState;

  const truncate = (string: string): string =>
    statusLineTruncate(maxWidth, fancy, string);

  switch (status.tag) {
    case "NotWrittenToDisk":
      return truncate(fancy ? `✅ ${targetName}` : `${targetName}: success`);

    case "Success": {
      const fileSize = printFileSize(
        outputState.compilationMode,
        status.fileSize
      );
      const fileSizeString =
        fileSize === undefined ? "" : ` (${dim(fileSize)})`;
      return truncate(
        fancy ? `✅ ${targetName}` : `${targetName}: success${fileSizeString}`
      );
    }

    case "ElmMake": {
      const arg = SpawnElm.compilationModeToArg(status.compilationMode);
      const flags = arg === undefined ? "" : ` ${arg}`;
      return truncate(`${fancy ? "⏳ " : ""}${targetName}: elm make${flags}`);
    }

    case "ElmMakeTypecheckOnly":
      return truncate(
        `${fancy ? "⏳ " : ""}${targetName}: elm make (typecheck only)`
      );

    case "Postprocess":
      return truncate(`${fancy ? "⏳ " : ""}${targetName}: postprocess`);

    case "Interrupted":
      return truncate(`${fancy ? "⏳ " : ""}${targetName}: interrupted`);

    case "QueuedForElmMake":
      return truncate(`${fancy ? "⚪️ " : ""}${targetName}: queued`);

    case "QueuedForPostprocess":
      return truncate(`${fancy ? "🟢 " : ""}${targetName}: elm make done`);

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
      return truncate(fancy ? `🚨 ${targetName}` : `${targetName}: error`);
  }
}

function statusLineTruncate(
  maxWidth: number,
  fancy: boolean,
  string: string
): string {
  // Emojis take two terminal columns.
  const length = fancy ? string.length + 1 : string.length;
  return length <= maxWidth
    ? string
    : fancy
    ? // Again, account for the emoji.
      `${string.slice(0, maxWidth - 2)}…`
    : `${string.slice(0, maxWidth - 3)}...`;
}

const KiB = 1024;
const MiB = KiB ** 2;

function printFileSize(
  compilationMode: CompilationMode,
  fileSize: number
): string | undefined {
  switch (compilationMode) {
    case "debug":
    case "standard":
      return undefined;

    case "optimize":
      return fileSize >= MiB
        ? `${(fileSize / MiB).toFixed(2)} MiB`
        : `${(fileSize / KiB).toFixed(0)} KiB`;
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
              status.error
            );

          case "ElmWatchNodeDefaultExportNotFunction":
            return Errors.elmWatchNodeDefaultExportNotFunction(
              status.scriptPath,
              status.imported
            );

          case "ElmWatchNodeRunError":
            return Errors.elmWatchNodeRunError(
              status.scriptPath,
              status.args,
              status.error
            );

          case "ElmWatchNodeBadReturnValue":
            return Errors.elmWatchNodeBadReturnValue(
              status.scriptPath,
              status.args,
              status.returnValue
            );

          case "ElmMakeJsonParseError":
            return Errors.elmMakeJsonParseError(
              outputPath,
              status.error,
              status.jsonPath,
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

function fallbackAllRelatedElmFilePaths(
  walkerError: GetAllRelatedElmFilePathsError,
  outputState: OutputState
): Set<string> {
  switch (walkerError.tag) {
    case "ImportWalkerFileSystemError":
      return walkerError.relatedElmFilePathsUntilError;

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
