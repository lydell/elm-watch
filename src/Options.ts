import * as path from "path";
import * as Codec from "tiny-decoders";

import type * as Public from "../index.d.ts";
import { AllowedHost } from "./AllowedHosts.ts";
import type {
  Config,
  OpenEditorFunction,
  PostprocessFunction,
} from "./Config.ts";
import {
  ElmJsonPathString,
  Inputs,
  Output,
  TargetName,
} from "./ElmWatchJson.ts";
import { isErrorReporter, setTargetNames } from "./ExternalErrors.ts";
import { Host } from "./Host.ts";
import { NonEmptyArray } from "./NonEmptyArray.ts";
import { Port } from "./Port.ts";
import {
  type AbsolutePath,
  CompilationMode,
  Compiler,
  markAsAbsolutePath,
  type RunMode,
} from "./Types.ts";
import { WebSocketUrl } from "./WebSocketUrl.ts";

// The options passed to `elmWatch()` are typed in index.d.ts, but we still
// validate them at runtime for JavaScript users (and for nicer error messages).

function functionCodec<T extends object>(): Codec.Codec<T> {
  return Codec.flatMap(Codec.unknown, {
    decoder: (value) =>
      typeof value === "function"
        ? { tag: "Valid", value: value as T }
        : {
            tag: "DecoderError",
            error: {
              tag: "custom",
              message: "Expected a function",
              got: value,
              path: [],
            },
          },
    // Encoding is never used.
    encoder: (value) => value,
  });
}

// Optional options can also be set to `undefined`, which is convenient when
// reading environment variables, for example: `host: process.env.ELM_WATCH_HOST`.
// oxlint-disable-next-line typescript/explicit-function-return-type
function optionalField<Decoded, Encoded>(codec: Codec.Codec<Decoded, Encoded>) {
  return Codec.field(Codec.undefinedOr(codec), { optional: true });
}

const Root = Codec.flatMap(Codec.string, {
  decoder: (string) =>
    path.isAbsolute(string)
      ? { tag: "Valid", value: markAsAbsolutePath(string) }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message:
              "Expected an absolute path (for example `import.meta.dirname`)",
            got: string,
            path: [],
          },
        },
  // Encoding is never used.
  encoder: (value): string => value,
});

const Target = Codec.taggedUnion(
  "type",
  [
    {
      type: Codec.tag("application"),
      name: TargetName,
      elmJson: ElmJsonPathString,
      compiler: optionalField(Compiler),
      inputs: Inputs,
      output: Output,
      postprocess: optionalField(functionCodec<PostprocessFunction>()),
    },
    {
      type: Codec.tag("package"),
      name: TargetName,
      elmJson: ElmJsonPathString,
      compiler: optionalField(Compiler),
    },
  ],
  { allowExtraFields: false },
);

const Targets = Codec.flatMap(NonEmptyArray(Target), {
  decoder: (targets) => {
    const seen = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (seen.has(target.name)) {
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: "Target names must be unique",
            got: target.name,
            path: [index, "name"],
          },
        };
      }
      seen.add(target.name);
    }
    return { tag: "Valid", value: targets };
  },
  // Encoding is never used.
  encoder: (value) => value,
});

const ErrorReporterCodec = Codec.flatMap(Codec.unknown, {
  decoder: (value) =>
    isErrorReporter(value)
      ? { tag: "Valid", value }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: "Expected an error reporter from `createErrorReporter()`",
            got: value,
            path: [],
          },
        },
  // Encoding is never used.
  encoder: (value) => value,
});

const Options = Codec.fields(
  {
    runMode: Codec.primitiveUnion(["hot", "make"]),
    compilationMode: optionalField(CompilationMode),
    root: Root,
    targets: Targets,
    port: optionalField(Port),
    host: optionalField(Host),
    staticFilesDir: optionalField(Codec.string),
    webSocketUrl: optionalField(WebSocketUrl("Options")),
    allowedHosts: optionalField(Codec.array(AllowedHost)),
    openEditor: optionalField(functionCodec<OpenEditorFunction>()),
    errors: optionalField(ErrorReporterCodec),
    // These are validated by TypeScript only.
    createServer: optionalField(functionCodec<object>()),
    signal: optionalField(Codec.unknown),
    env: optionalField(Codec.unknown),
    stdin: optionalField(Codec.unknown),
    stdout: optionalField(Codec.unknown),
    stderr: optionalField(Codec.unknown),
  },
  { allowExtraFields: false },
);

// The codecs decode to stricter types than index.d.ts (branded strings, etc.),
// so the types can’t be compared directly. But make sure that they have the
// same fields, and the same optional fields.
type OptionalKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? K : never;
}[keyof T];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Check<T extends true> = T;
export type OptionsInSyncWithIndexDts = [
  Check<Same<keyof Public.Options, keyof Codec.Infer<typeof Options>>>,
  Check<
    Same<
      OptionalKeys<Public.Options>,
      OptionalKeys<Codec.Infer<typeof Options>>
    >
  >,
  Check<Same<keyof Public.Target, keyof Codec.Infer<typeof Target>>>,
  Check<
    Same<OptionalKeys<Public.Target>, OptionalKeys<Codec.Infer<typeof Target>>>
  >,
];

export type DecodeOptionsResult =
  | {
      tag: "DecoderError";
      error: Codec.DecoderError;
    }
  | {
      tag: "Valid";
      runMode: RunMode;
      compilationMode: CompilationMode;
      config: Config;
    };

export function decodeOptions(options: unknown): DecodeOptionsResult {
  const result = Options.decoder(options);
  switch (result.tag) {
    case "DecoderError":
      return result;
    case "Valid": {
      const { value } = result;
      const root: AbsolutePath = value.root;
      const [clash] =
        value.errors === undefined
          ? []
          : setTargetNames(
              value.errors,
              value.targets.map((target) => target.name),
            );
      if (clash !== undefined) {
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message:
              "An error source passed to `set()` has the same name as a target",
            got: clash,
            path: ["errors"],
          },
        };
      }
      return {
        tag: "Valid",
        runMode: value.runMode,
        compilationMode: value.compilationMode ?? "standard",
        config: {
          root,
          source: { tag: "Options" },
          targets: value.targets.map((target): Config["targets"][number] => {
            switch (target.type) {
              case "application":
                return {
                  type: target.type,
                  name: target.name,
                  elmJson: target.elmJson,
                  compiler: target.compiler ?? "elm",
                  inputs: target.inputs,
                  output: target.output,
                  postprocess: target.postprocess,
                };
              case "package":
                return {
                  type: target.type,
                  name: target.name,
                  elmJson: target.elmJson,
                  compiler: target.compiler ?? "elm",
                };
            }
          }) as NonEmptyArray<Config["targets"][number]>,
          port: value.port,
          host: value.host,
          webSocketUrl: value.webSocketUrl,
          staticFilesDir: value.staticFilesDir,
          allowedHosts: value.allowedHosts ?? [],
          openEditor: value.openEditor,
          errorReporter: value.errors,
        },
      };
    }
  }
}
