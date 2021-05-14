import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { bold, getSetSingleton } from "./helpers";
import type { Logger } from "./logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
  Cwd,
  findClosest,
  longestCommonAncestorPath,
} from "./path-helpers";

type RunMode = "hot" | "make" | "watch";

type CompilationMode = ReturnType<typeof CompilationMode>;
const CompilationMode = Decode.stringUnion({
  standard: null,
  debug: null,
  optimize: null,
});

// elm-tooling.json
type ElmToolingJsonPath = {
  tag: "ElmToolingJsonPath";
  theElmToolingJsonPath: AbsolutePath;
};

// elm.json
type ElmJsonPath = {
  tag: "ElmJsonPath";
  theElmJsonPath: AbsolutePath;
};

// src/Main.elm
type InputPath = {
  tag: "InputPath";
  theInputPath: AbsolutePath;
};

// build/main.js
type OutputPath = {
  tag: "OutputPath";
  theOutputPath: AbsolutePath;
};

export default async function run(
  cwd: Cwd,
  logger: Logger,
  runMode: RunMode,
  args: Array<string>
): Promise<number> {
  const parseResult = findReadAndParseElmToolingJson(cwd);

  switch (parseResult.tag) {
    case "ReadAsJsonError":
      logger.error(
        readAsJsonError(parseResult.elmToolingJsonPath, parseResult.error)
      );
      return 1;

    case "DecodeError":
      logger.error(
        decodeError(parseResult.elmToolingJsonPath, parseResult.error)
      );
      return 1;

    case "ElmToolingJsonNotFound":
      logger.error(elmToolingJsonNotFoundError(cwd, args));
      return 1;

    case "Parsed": {
      const badArgs = args.filter((arg) => !isValidOutputName(arg));

      if (isNonEmptyArray(badArgs)) {
        logger.error(
          badArgsError(cwd, parseResult.elmToolingJsonPath, args, badArgs)
        );
        return 1;
      }

      const { outputs } = parseResult.config;
      const unknownOutputs = args.filter(
        (arg) => !Object.prototype.hasOwnProperty.call(outputs, arg)
      );

      if (isNonEmptyArray(unknownOutputs)) {
        logger.error(
          unknownOutputsError(
            parseResult.elmToolingJsonPath,
            // The decoder validates that there’s at least one output.
            Object.keys(outputs) as NonEmptyArray<string>,
            unknownOutputs
          )
        );
        return 1;
      }

      const initStateResult = initState(
        cwd,
        runMode,
        parseResult.elmToolingJsonPath,
        parseResult.config,
        isNonEmptyArray(args) ? new Set(args) : new Set(Object.keys(outputs))
      );

      switch (initStateResult.tag) {
        case "NoCommonRoot":
          logger.error(noCommonRootError(initStateResult.paths));
          return 1;

        case "State":
          await Promise.resolve();
          logger.log(
            `Run: ${runMode}\n${JSON.stringify(
              initStateResult.state,
              (_, value: unknown) =>
                value instanceof Set || value instanceof HashMap
                  ? Array.from(value)
                  : value,
              2
            )}`
          );
          return 0;
      }
    }
  }
}

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const INPUT_NAME = /(^|[/\\])\p{Lu}[_\d\p{L}]*\.elm$/u;

function isValidInputName(name: string): boolean {
  return INPUT_NAME.test(name);
}

function isValidOutputName(name: string): boolean {
  // `elm make` doesn’t accept just `.js` but `a.js` and `a/.js`.
  return (name.endsWith(".js") && name !== ".js") || name === "/dev/null";
}

const elmToolingJson = bold("elm-tooling.json");

function readAsJsonError(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: Error
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

${bold("But I had trouble reading it as JSON:")}

${error.message}
  `.trim();
}

function decodeError(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: Decode.DecoderError
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

${bold("But I had trouble with the JSON inside:")}

${error.format()}
  `.trim();
}

function elmToolingJsonNotFoundError(cwd: Cwd, args: Array<string>): string {
  const example = elmToolingJsonExample(
    cwd,
    {
      tag: "ElmToolingJsonPath",
      theElmToolingJsonPath: absolutePathFromString(
        cwd.path,
        "elm-tooling.json"
      ),
    },
    args
  );

  return `
I read inputs, outputs and options from ${elmToolingJson}.

${bold("But I couldn’t find one!")}

You need to create one with JSON like this:

${example}
  `.trim();
}

function badArgsError(
  cwd: Cwd,
  elmToolingJsonPath: ElmToolingJsonPath,
  args: Array<string>,
  badArgs: NonEmptyArray<string>
): string {
  return `
${bold(
  "I only accept JS file paths as arguments, but I got some that don’t look like that:"
)}

${badArgs.join("\n")}

You either need to remove those arguments or move them to the ${elmToolingJson} I found here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

For example, you could add some JSON like this:

${elmToolingJsonExample(cwd, elmToolingJsonPath, args)}
  `.trim();
}

function unknownOutputsError(
  elmToolingJsonPath: ElmToolingJsonPath,
  knownOutputs: NonEmptyArray<string>,
  unknownOutputs: NonEmptyArray<string>
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

It contains these outputs:

${knownOutputs.join("\n")}

${bold("But those don’t include these outputs you asked me to build:")}

${unknownOutputs.join("\n")}

Is something misspelled? (You need to type them exactly the same.)
Or do you need to add some more outputs?
  `.trim();
}

function noCommonRootError(paths: NonEmptyArray<AbsolutePath>): string {
  return `
I could not find a common ancestor for these paths:

${paths.join("\n")}

${bold("Files on different drives is not supported.")}
  `.trim();
}

function elmToolingJsonExample(
  cwd: Cwd,
  elmToolingJsonPath: ElmToolingJsonPath,
  args: Array<string>
): string {
  const {
    elmFiles,
    compilationMode,
    output = "build/main.js",
  } = parseArgsLikeElmMake(args);

  const example: ElmToolingJson = {
    "x-elm-watch": {
      outputs: {
        [output]: {
          inputs: isNonEmptyArray(elmFiles)
            ? mapNonEmptyArray(elmFiles, (file) =>
                path.relative(
                  path.dirname(
                    elmToolingJsonPath.theElmToolingJsonPath.absolutePath
                  ),
                  path.resolve(cwd.path.absolutePath, file)
                )
              )
            : ["src/Main.elm"],
          mode: compilationMode === "standard" ? undefined : compilationMode,
        },
      },
    },
  };

  return JSON.stringify(example, null, 4);
}

type ElmMakeParsed = {
  elmFiles: Array<string>;
  compilationMode: CompilationMode;
  output: string | undefined;
};

type IntermediaElmMakeParsed = ElmMakeParsed & { justSawOutputFlag: boolean };

function parseArgsLikeElmMake(args: Array<string>): ElmMakeParsed {
  return args.reduce<IntermediaElmMakeParsed>(
    (passedParsed, arg): IntermediaElmMakeParsed => {
      const parsed = { ...passedParsed, justSawOutputFlag: false };
      switch (arg) {
        case "--debug":
          return { ...parsed, compilationMode: "debug" };

        case "--optimize":
          return { ...parsed, compilationMode: "optimize" };

        case "--output":
          return { ...parsed, justSawOutputFlag: true };

        default: {
          if (passedParsed.justSawOutputFlag) {
            return isValidOutputName(arg) ? { ...parsed, output: arg } : parsed;
          }

          const outputPrefix = "--output=";
          if (arg.startsWith(outputPrefix)) {
            const file = arg.slice(outputPrefix.length);
            return isValidOutputName(file)
              ? { ...parsed, output: file }
              : parsed;
          }

          return isValidInputName(arg)
            ? { ...parsed, elmFiles: parsed.elmFiles.concat(arg) }
            : parsed;
        }
      }
    },
    {
      elmFiles: [],
      compilationMode: "standard",
      output: undefined,
      justSawOutputFlag: false,
    }
  );
}

const Output = Decode.fieldsAuto(
  {
    inputs: NonEmptyArray(
      Decode.chain(Decode.string, (string) => {
        if (isValidInputName(string)) {
          return string;
        }
        throw new Decode.DecoderError({
          message: "Inputs must have a valid module name and end with .elm",
          value: string,
        });
      })
    ),
    mode: Decode.optional(CompilationMode),
  },
  { exact: "throw" }
);

type Config = ReturnType<typeof Config>;
const Config = Decode.fieldsAuto({
  outputs: Decode.chain(Decode.record(Output), (record) => {
    const entries = Object.entries(record);
    if (!isNonEmptyArray(entries)) {
      throw new Decode.DecoderError({
        message: "Expected a non-empty object",
        value: record,
      });
    }
    return Object.fromEntries(
      entries.map(([key, value]) => {
        if (isValidOutputName(key)) {
          return [key, value];
        }
        throw new Decode.DecoderError({
          message: "Outputs must end with .js or be /dev/null",
          value: Decode.DecoderError.MISSING_VALUE,
          key,
        });
      })
    );
  }),
});

type ElmToolingJson = ReturnType<typeof ElmToolingJson>;
const ElmToolingJson = Decode.fieldsAuto({
  "x-elm-watch": Config,
});

export type ParseResult =
  | {
      tag: "DecodeError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: Decode.DecoderError;
    }
  | {
      tag: "ElmToolingJsonNotFound";
    }
  | {
      tag: "Parsed";
      elmToolingJsonPath: ElmToolingJsonPath;
      config: Config;
    }
  | {
      tag: "ReadAsJsonError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: Error;
    };

function findReadAndParseElmToolingJson(cwd: Cwd): ParseResult {
  const elmToolingJsonPathRaw = findClosest("elm-tooling.json", cwd.path);
  if (elmToolingJsonPathRaw === undefined) {
    return {
      tag: "ElmToolingJsonNotFound",
    };
  }

  const elmToolingJsonPath: ElmToolingJsonPath = {
    tag: "ElmToolingJsonPath",
    theElmToolingJsonPath: elmToolingJsonPathRaw,
  };

  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(elmToolingJsonPathRaw.absolutePath, "utf-8")
    );
  } catch (errorAny) {
    const error = errorAny as Error;
    return {
      tag: "ReadAsJsonError",
      elmToolingJsonPath,
      error,
    };
  }

  try {
    return {
      tag: "Parsed",
      elmToolingJsonPath,
      config: ElmToolingJson(json)["x-elm-watch"],
    };
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
    return {
      tag: "DecodeError",
      elmToolingJsonPath,
      error,
    };
  }
}

type State = {
  // Path to the longest ancestor of elm-tooling.json and all elm.json.
  watchRoot: AbsolutePath;
  cwd: Cwd;
  runMode: RunMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  disabledOutputs: HashSet<OutputPath>;
  elmJsonsErrors: Array<ElmJsonError>;
  elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
  // Maybe also websocket connections in the future.
};

type OutputState = {
  inputs: NonEmptyArray<InputPath>;
  mode: CompilationMode;
};

type InitStateResult =
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<AbsolutePath>;
    }
  | {
      tag: "State";
      state: State;
    };

function initState(
  cwd: Cwd,
  runMode: RunMode,
  elmToolingJsonPath: ElmToolingJsonPath,
  config: Config,
  enabledOutputs: Set<string>
): InitStateResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<ElmJsonError> = [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();

  for (const [outputPathString, output] of Object.entries(config.outputs)) {
    const outputPath: OutputPath = {
      tag: "OutputPath",
      theOutputPath: absolutePathFromString(
        elmToolingJsonPath.theElmToolingJsonPath,
        outputPathString
      ),
    };

    if (enabledOutputs.has(outputPathString)) {
      const inputs = mapNonEmptyArray(
        output.inputs,
        (inputString): InputPath => ({
          tag: "InputPath",
          theInputPath: absolutePathFromString(
            elmToolingJsonPath.theElmToolingJsonPath,
            inputString
          ),
        })
      );

      const resolveElmJsonResult = resolveElmJson(inputs);

      switch (resolveElmJsonResult.tag) {
        case "ElmJsonPath": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new HashMap<OutputPath, OutputState>();

          previous.set(outputPath, {
            inputs,
            mode: output.mode ?? "standard",
          });
          elmJsons.set(resolveElmJsonResult.elmJsonPath, previous);
          break;
        }

        case "ElmJsonError":
          elmJsonsErrors.push(resolveElmJsonResult);
          break;
      }
    } else {
      disabledOutputs.add(outputPath);
    }
  }

  const paths = mapNonEmptyArray(
    [
      elmToolingJsonPath.theElmToolingJsonPath,
      ...Array.from(
        elmJsons.keys(),
        (elmJsonPath) => elmJsonPath.theElmJsonPath
      ),
    ],
    (absolutePath) => absoluteDirname(absolutePath)
  );

  const watchRoot =
    longestCommonAncestorPath(paths) ??
    // On Windows, you can have one `C:` and one `D:` path and they don’t have
    // any overlap. Just go with the elm-tooling.json path in that case.
    elmToolingJsonPath.theElmToolingJsonPath;

  if (watchRoot === undefined) {
    return {
      tag: "NoCommonRoot",
      paths,
    };
  }

  return {
    tag: "State",
    state: {
      watchRoot,
      cwd,
      runMode,
      elmToolingJsonPath,
      disabledOutputs,
      elmJsonsErrors,
      elmJsons,
    },
  };
}

type ResolveElmJsonResult =
  | ElmJsonError
  | {
      tag: "ElmJsonPath";
      elmJsonPath: ElmJsonPath;
    };

type ElmJsonError = {
  tag: "ElmJsonError";
  elmJsonNotFound: Array<InputPath>;
  nonUniqueElmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }>;
};

function resolveElmJson(
  inputs: NonEmptyArray<InputPath>
): ResolveElmJsonResult {
  const elmJsonNotFound: Array<InputPath> = [];
  const elmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }> = [];

  for (const inputPath of inputs) {
    const elmJsonPathRaw = findClosest(
      "elm.json",
      absoluteDirname(inputPath.theInputPath)
    );
    if (elmJsonPathRaw === undefined) {
      elmJsonNotFound.push(inputPath);
    } else {
      elmJsonPaths.push({
        inputPath,
        elmJsonPath: { tag: "ElmJsonPath", theElmJsonPath: elmJsonPathRaw },
      });
    }
  }

  const elmJsonPathsSet = new HashSet(
    elmJsonPaths.map(({ elmJsonPath }) => elmJsonPath)
  );

  const uniqueElmJsonPath = getSetSingleton(elmJsonPathsSet);

  return isNonEmptyArray(elmJsonNotFound)
    ? {
        tag: "ElmJsonError",
        elmJsonNotFound,
        nonUniqueElmJsonPaths:
          uniqueElmJsonPath === undefined ? elmJsonPaths : [],
      }
    : uniqueElmJsonPath === undefined
    ? {
        tag: "ElmJsonError",
        elmJsonNotFound: [],
        nonUniqueElmJsonPaths: elmJsonPaths,
      }
    : {
        tag: "ElmJsonPath",
        elmJsonPath: uniqueElmJsonPath,
      };
}
