import * as path from "path";
import * as Codec from "tiny-decoders";

import { AllowedHost } from "./AllowedHosts.ts";
import type { Config, PostprocessFunction } from "./Config.ts";
import { Inputs, Output, TargetName } from "./ElmWatchJson.ts";
import { NonEmptyArray } from "./NonEmptyArray.ts";
import { Port } from "./Port.ts";
import {
  type AbsolutePath,
  CompilationMode,
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
    /* v8 ignore next -- @preserve */
    encoder: (value) => value,
  });
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
  /* v8 ignore next -- @preserve */
  encoder: (value): string => value,
});

const Target = Codec.fields(
  {
    name: TargetName,
    inputs: Inputs,
    output: Output,
    postprocess: Codec.field(functionCodec<PostprocessFunction>(), {
      optional: true,
    }),
  },
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
  /* v8 ignore next -- @preserve */
  encoder: (value) => value,
});

const Options = Codec.fields(
  {
    runMode: Codec.primitiveUnion(["hot", "make"]),
    compilationMode: Codec.field(CompilationMode, { optional: true }),
    root: Root,
    targets: Targets,
    port: Codec.field(Port, { optional: true }),
    staticFilesDir: Codec.field(Codec.string, { optional: true }),
    webSocketUrl: Codec.field(WebSocketUrl("Options"), { optional: true }),
    allowedHosts: Codec.field(Codec.array(AllowedHost), { optional: true }),
    // These are validated by TypeScript only.
    createServer: Codec.field(functionCodec<object>(), { optional: true }),
    env: Codec.field(Codec.unknown, { optional: true }),
    stdin: Codec.field(Codec.unknown, { optional: true }),
    stdout: Codec.field(Codec.unknown, { optional: true }),
    stderr: Codec.field(Codec.unknown, { optional: true }),
  },
  { allowExtraFields: false },
);

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
      return {
        tag: "Valid",
        runMode: value.runMode,
        compilationMode: value.compilationMode ?? "standard",
        config: {
          root,
          source: { tag: "Options" },
          targets: value.targets.map((target) => ({
            name: target.name,
            inputs: target.inputs,
            output: target.output,
            postprocess: target.postprocess,
          })) as NonEmptyArray<Config["targets"][number]>,
          port: value.port,
          webSocketUrl: value.webSocketUrl,
          staticFilesDir: value.staticFilesDir,
          allowedHosts: value.allowedHosts ?? [],
        },
      };
    }
  }
}
