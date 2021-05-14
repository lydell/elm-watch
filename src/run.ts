import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import {
  bold,
  deepestCommonAncestorPath as longestCommonAncestorPath,
  findClosest,
  getSetSingleton,
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./helpers";
import type { Logger } from "./logger";

type RunMode = "hot" | "make" | "watch";

type CompilationMode = ReturnType<typeof CompilationMode>;
const CompilationMode = Decode.stringUnion({
  standard: null,
  debug: null,
  optimize: null,
});

export default async function run(
  cwd: string,
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
                value instanceof Set
                  ? Array.from(value)
                  : value instanceof Map
                  ? (Object.fromEntries(value) as unknown)
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

function readAsJsonError(elmToolingJsonPath: string, error: Error): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath}

${bold("But I had trouble reading it as JSON:")}

${error.message}
  `.trim();
}

function decodeError(
  elmToolingJsonPath: string,
  error: Decode.DecoderError
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath}

${bold("But I had trouble with the JSON inside:")}

${error.format()}
  `.trim();
}

function elmToolingJsonNotFoundError(cwd: string, args: Array<string>): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

${bold("But I couldn’t find one!")}

You need to create one with JSON like this:

${elmToolingJsonExample(cwd, cwd, args)}
  `.trim();
}

function badArgsError(
  cwd: string,
  elmToolingJsonPath: string,
  args: Array<string>,
  badArgs: NonEmptyArray<string>
): string {
  return `
${bold(
  "I only accept JS file paths as arguments, but I got some that don’t look like that:"
)}

${badArgs.join("\n")}

You either need to remove those arguments or move them to the ${elmToolingJson} I found here:

${elmToolingJsonPath}

For example, you could add some JSON like this:

${elmToolingJsonExample(cwd, elmToolingJsonPath, args)}
  `.trim();
}

function unknownOutputsError(
  elmToolingJsonPath: string,
  knownOutputs: NonEmptyArray<string>,
  unknownOutputs: NonEmptyArray<string>
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath}

It contains these outputs:

${knownOutputs.join("\n")}

${bold("But those don’t include these outputs you asked me to build:")}

${unknownOutputs.join("\n")}

Is something misspelled? Or do you need to add some more outputs?
  `.trim();
}

function noCommonRootError(paths: NonEmptyArray<string>): string {
  return `
I could not find a common ancestor for these paths:

${paths.join("\n")}

${bold("Files on different drives is not supported.")}
  `.trim();
}

function elmToolingJsonExample(
  cwd: string,
  elmToolingJsonPath: string,
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
                  path.dirname(elmToolingJsonPath),
                  path.resolve(cwd, file)
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
      elmToolingJsonPath: string;
      error: Decode.DecoderError;
    }
  | {
      tag: "ElmToolingJsonNotFound";
    }
  | {
      tag: "Parsed";
      elmToolingJsonPath: string;
      config: Config;
    }
  | {
      tag: "ReadAsJsonError";
      elmToolingJsonPath: string;
      error: Error;
    };

function findReadAndParseElmToolingJson(cwd: string): ParseResult {
  const elmToolingJsonPath = findClosest("elm-tooling.json", cwd);
  if (elmToolingJsonPath === undefined) {
    return {
      tag: "ElmToolingJsonNotFound",
    };
  }

  let json: unknown = undefined;
  try {
    json = JSON.parse(fs.readFileSync(elmToolingJsonPath, "utf-8"));
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
  // Path to the directory containing elm-tooling.json and all elm.json.
  watchRoot: string;
  cwd: string;
  runMode: RunMode;
  elmToolingJsonPath: string;
  disabledOutputs: Set<string>;
  elmJsonsErrors: Array<ElmJsonError>;
  // elm.json path to output path to OutputState.
  elmJsons: Map<string, Map<string, OutputState>>;
  // Maybe also websocket connections in the future.
};

type OutputState = {
  inputs: NonEmptyArray<string>;
  mode: CompilationMode;
};

type InitStateResult =
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<string>;
    }
  | {
      tag: "State";
      state: State;
    };

function initState(
  cwd: string,
  runMode: RunMode,
  elmToolingJsonPath: string,
  config: Config,
  enabledOutputs: Set<string>
): InitStateResult {
  const disabledOutputs = new Set<string>();
  const elmJsonsErrors: Array<ElmJsonError> = [];
  const elmJsons = new Map<string, Map<string, OutputState>>();

  for (const [outputPath, output] of Object.entries(config.outputs)) {
    if (enabledOutputs.has(outputPath)) {
      const resolveElmJsonResult = resolveElmJson(cwd, output.inputs);
      switch (resolveElmJsonResult.tag) {
        case "ElmJsonPath": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new Map<string, OutputState>();
          previous.set(outputPath, {
            inputs: output.inputs,
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

  const paths: NonEmptyArray<string> = mapNonEmptyArray(
    [elmToolingJsonPath, ...elmJsons.keys()],
    (stringPath) => path.dirname(stringPath)
  );

  const watchRoot =
    longestCommonAncestorPath(paths) ??
    // On Windows, you can have one `C:` and one `D:` path and they don’t have
    // any overlap. Just go with the elm-tooling.json path in that case.
    elmToolingJsonPath;

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
      elmJsonPath: string;
    };

type ElmJsonError = {
  tag: "ElmJsonError";
  elmJsonNotFound: Array<string>;
  nonUniqueElmJsonPaths: Array<{ input: string; elmJsonPath: string }>;
};

function resolveElmJson(
  cwd: string,
  inputs: NonEmptyArray<string>
): ResolveElmJsonResult {
  const elmJsonNotFound: Array<string> = [];
  const elmJsonPaths: Array<{ input: string; elmJsonPath: string }> = [];

  for (const input of inputs) {
    const elmJsonPath = findClosest("elm.json", cwd);
    if (elmJsonPath === undefined) {
      elmJsonNotFound.push(input);
    } else {
      elmJsonPaths.push({ input, elmJsonPath });
    }
  }

  const elmJsonPathsSet = new Set(
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
