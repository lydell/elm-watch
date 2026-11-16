import * as fs from "fs";
import * as path from "path";

import { EDITOR_PLACEHOLDERS } from "./Editor.ts";
import { ELM_WATCH_OPEN_EDITOR, type Env } from "./Env.ts";
import { bold, dim, toError } from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import {
  openEditorFromEnv,
  printOpenEditorErrorForTerminal,
} from "./OpenEditor.ts";
import { absoluteDirname, findClosest } from "./PathHelpers.ts";
import type { Terminal } from "./Terminal.ts";
import type { AbsolutePath, CliArg, Cwd } from "./Types.ts";

// `elm-watch editor`: Helps setting up `ELM_WATCH_OPEN_EDITOR`. When it isn’t
// set, explains how to try out values and how to set it permanently. When it
// is set, tries it out, without having to restart `elm-watch hot` and click an
// error location: Opens the closest package.json, which very likely exists
// since elm-watch is installed via npm. The "elm-watch" line is a good place to
// put the cursor: It’s usually neither on the first line nor in the first
// column, so it’s easy to see if the line or column is off by one.
export async function editorCommand(
  cwd: Cwd,
  env: Env,
  terminal: Terminal,
  args: Array<CliArg>,
): Promise<number> {
  if (args.length > 0) {
    terminal.writeToStderrMakesALotOfSenseHere(
      `${bold("elm-watch editor")} takes no arguments.`,
    );
    return 1;
  }

  const value = env[ELM_WATCH_OPEN_EDITOR];
  if (value === undefined || value === "") {
    terminal.write(gettingStarted(env));
    return 0;
  }

  const file = findClosest("package.json", cwd);
  if (file === undefined) {
    terminal.writeToStderrMakesALotOfSenseHere(noPackageJson(cwd));
    return 1;
  }

  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    terminal.writeToStderrMakesALotOfSenseHere(readError(file, error));
    return 1;
  }

  const lines = content.split("\n");
  const lineIndex = lines.findIndex((line) => line.includes('"elm-watch"'));
  const lineText = lines[lineIndex] ?? "";
  const location = {
    file,
    line: lineIndex === -1 ? 1 : lineIndex + 1,
    column: lineIndex === -1 ? 1 : lineText.indexOf('"elm-watch"') + 1,
  };

  terminal.write(
    opening(
      value,
      location,
      lineIndex === -1 ? undefined : lineText.replace(/\r$/, ""),
    ),
  );

  const error = await openEditorFromEnv(
    env,
    absoluteDirname(file),
    location,
    value,
  );
  if (error !== undefined) {
    terminal.write("");
    terminal.writeToStderrMakesALotOfSenseHere(
      printOpenEditorErrorForTerminal(error),
    );
    return 1;
  }

  terminal.write("");
  terminal.write(opened(env, value));
  return 0;
}

const URL_EXAMPLE = "pycharm://open?file={file}&line={line}&column={column0}";

const DOCS_URL =
  "https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations";

function gettingStarted(env: Env): string {
  const variables = EDITOR_PLACEHOLDERS.map((placeholder) =>
    IS_WINDOWS
      ? `%${placeholder.slice(1, -1)}%`
      : `$${placeholder.slice(1, -1)}`,
  );
  const commandExample = IS_WINDOWS
    ? `your-editor "%file%:%line%:%column%"`
    : `your-editor "$file:$line:$column"`;
  return `
${bold("elm-watch editor")} helps you set up the ${ELM_WATCH_OPEN_EDITOR} environment variable, for opening error locations in your editor.

${bold("1. Try out a value, either:")}

   ${bold("An editor URL:")}

       ${tryCommand(URL_EXAMPLE)}

       ${dim("placeholders:")} ${EDITOR_PLACEHOLDERS.join(" ")}

   ${bold("Or a shell command:")}

       ${tryCommand(commandExample)}

       ${dim("variables:")} ${variables.join(" ")}

   That opens package.json in your editor, at the line and column of "elm-watch".
   Edit and re-run the command until you get it right.

${bold("2. Set it permanently")}

${indent(setPermanently(env, "..."), "   ")}

${bold(`3. ${restartWhat(env)}`)}

More info: ${DOCS_URL}
  `.trim();
}

function opened(env: Env, value: string): string {
  return `
Not right? Adjust the value and try again. Once it works, set it permanently (if you haven’t already):

${setPermanently(env, value)}

Then ${restartWhat(env).toLowerCase()}.
  `.trim();
}

// `set -Ux` in fish affects running shells right away. Otherwise, the shell
// needs to be restarted to pick up the environment variable.
function restartWhat(env: Env): string {
  return !IS_WINDOWS && getShell(env) === "fish"
    ? "Restart elm-watch"
    : "Restart the shell and elm-watch";
}

function indent(string: string, indentation: string): string {
  return string.replace(/^/gm, indentation);
}

function noPackageJson(cwd: Cwd): string {
  return `
${bold("elm-watch editor")} opens the closest package.json, but I couldn’t find one in this directory or any of its parents:

${cwd}
  `.trim();
}

function readError(file: AbsolutePath, error: unknown): string {
  return `
I tried to read the closest package.json, but failed:

${file}

${toError(error).message}
  `.trim();
}

function opening(
  value: string,
  location: { file: AbsolutePath; line: number; column: number },
  // `undefined` if "elm-watch" wasn’t found in package.json.
  lineText: string | undefined,
): string {
  const position = `${location.file}:${location.line}:${location.column}`;
  return `
Opening package.json using ${ELM_WATCH_OPEN_EDITOR}:

${value}

${
  lineText === undefined
    ? `package.json does not mention "elm-watch", so your editor should show the cursor at the very start of the file:

${position}`
    : `Your editor should show the cursor right before "elm-watch":

${position}
${lineText}
${" ".repeat(location.column - 1)}^`
}
  `.trim();
}

// Set the environment variable just for one `elm-watch editor` run.
function tryCommand(value: string): string {
  return IS_WINDOWS
    ? `$env:${ELM_WATCH_OPEN_EDITOR}=${quotePowerShell(value)}; elm-watch editor`
    : `${ELM_WATCH_OPEN_EDITOR}=${quotePosix(value)} elm-watch editor`;
}

// How to set `ELM_WATCH_OPEN_EDITOR` permanently in the user’s shell.
function setPermanently(env: Env, value: string): string {
  if (IS_WINDOWS) {
    return [
      "System Settings > Environment Variables",
      `Name: ${ELM_WATCH_OPEN_EDITOR}`,
      `Value: ${value}`,
    ].join("\n");
  }
  const shell = getShell(env);
  switch (shell) {
    case "fish":
      return [
        "# Run once:",
        `set -Ux ${ELM_WATCH_OPEN_EDITOR} ${quoteFish(value)}`,
      ].join("\n");
    case "bash":
    case "zsh":
      return [
        `# ~/.${shell}rc`,
        `export ${ELM_WATCH_OPEN_EDITOR}=${quotePosix(value)}`,
      ].join("\n");
    default:
      return [
        "# Your shell’s config file",
        `export ${ELM_WATCH_OPEN_EDITOR}=${quotePosix(value)}`,
      ].join("\n");
  }
}

function getShell(env: Env): string {
  return path.basename(env["SHELL"] ?? "");
}

// Single quotes, since both URLs (`{file}`) and commands (`$file`) contain
// characters that shells would otherwise replace.
function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quoteFish(value: string): string {
  return `'${value.replace(/[\\']/g, "\\$&")}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
