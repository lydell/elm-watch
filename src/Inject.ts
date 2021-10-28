import * as ClientCode from "./ClientCode";
import * as Errors from "./Errors";
import { AbsolutePath } from "./PathHelpers";

type Replacement = [
  search: RegExp | string,
  replacement: string,
  mode?: "AllowNoMatches" | "RequireMatch"
];

type InjectResult =
  | InjectError
  | {
      tag: "Success";
      code: string;
    };

export type InjectError = {
  tag: "InjectSearchAndReplaceNotFound";
  errorFilePath: Errors.ErrorFilePath;
};

const mainReplacements: Array<Replacement> = [];

const debuggerReplacements: Array<Replacement> = [];

const debuggerRegex = /^console.warn\(['"]Compiled in DEBUG mode/m;

export function inject(cwd: AbsolutePath, code: string): InjectResult {
  const result1 = runReplacements(cwd, code, mainReplacements);

  switch (result1.tag) {
    case "InjectSearchAndReplaceNotFound":
      return result1;

    case "Success": {
      const result2 = debuggerRegex.test(code)
        ? runReplacements(cwd, result1.code, debuggerReplacements)
        : result1;

      switch (result2.tag) {
        case "InjectSearchAndReplaceNotFound":
          return result2;

        case "Success":
          return {
            tag: "Success",
            code: `${result2.code}\n${ClientCode.code}`,
          };
      }
    }
  }
}

function runReplacements(
  cwd: AbsolutePath,
  code: string,
  replacements: Array<Replacement>
): InjectResult {
  return replacements.reduce<InjectResult>(
    (result, replacement) => {
      switch (result.tag) {
        case "Success":
          return strictReplace(cwd, result.code, replacement);
        case "InjectSearchAndReplaceNotFound":
          return result;
      }
    },
    { tag: "Success", code }
  );
}

function strictReplace(
  cwd: AbsolutePath,
  code: string,
  [search, replacement, mode = "RequireMatch"]: Replacement
): InjectResult {
  const parts = code.split(search);
  return mode === "RequireMatch" && parts.length <= 1
    ? {
        tag: "InjectSearchAndReplaceNotFound",
        errorFilePath: Errors.tryWriteErrorFile(
          cwd,
          "InjectSearchAndReplaceNotFound",
          "txt",
          replaceErrorContent(search, replacement, code)
        ),
      }
    : {
        tag: "Success",
        code:
          typeof search === "string"
            ? parts.join(replacement)
            : code.replace(search, replacement),
      };
}

function replaceErrorContent(
  search: RegExp | string,
  replacement: string,
  code: string
): string {
  return `
Modifying Elm's JS output for hot reloading failed!

### Code to replace (not found!):
${search.toString()}

### Replacement:
${replacement}

### Input code:
${code}
`.trimStart();
}

const proxyFileIIFE = (scope: Record<string, unknown>): void => {
  const error = new Error(
    `
Certain parts of \`window.Elm\` aren't available yet! That's fine though!

\`elm-watch\` has generated a stub file in place of Elm's compiled JS. This is
because until just now, there was no need to spend time on generating JS!

This stub file is now connecting to \`elm-watch\` via WebSocket, letting it know
that it's time to start generating real JS. Once that's done the page should be
automatically reloaded. But if you get compilation errors you'll need to fix
them first.
  `.trim()
  );

  const existing = scope.Elm;
  const existingObject =
    typeof existing === "object" && existing !== null ? existing : undefined;

  const elmProxy = new Proxy(existingObject ?? {}, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (value !== undefined) {
        return value;
      }
      throw error;
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor !== undefined) {
        return descriptor;
      }
      throw error;
    },
    has(target, property) {
      const has = Reflect.has(target, property);
      if (has) {
        return true;
      }
      throw error;
    },
    ownKeys() {
      throw error;
    },
  });

  scope.Elm = elmProxy;
};

export function proxyFile(): Buffer {
  // TODO: Also inject websocket stuff.
  return Buffer.from(`(${proxyFileIIFE.toString()})(this);`);
}
