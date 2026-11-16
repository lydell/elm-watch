import * as fs from "fs";

import { ELM_WATCH_OPEN_EDITOR, type Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import { bold } from "./Helpers.ts";
import {
  getCommandHint,
  openEditorFromEnv,
  printOpenEditorErrorForTerminal,
} from "./OpenEditor.ts";
import { absoluteDirname, findClosest } from "./PathHelpers.ts";
import type { Terminal } from "./Terminal.ts";
import type { CliArg, Cwd } from "./Types.ts";

// `elm-watch try-open`: A quick way to try out `ELM_WATCH_OPEN_EDITOR`,
// without having to restart `elm-watch hot` and click an error location.
// Opens the closest package.json, which very likely exists since elm-watch is
// installed via npm. The "elm-watch" line is a good place to put the cursor:
// It’s usually neither on the first line nor in the first column, so it’s
// easy to see if the line or column is off by one.
export async function tryOpen(
  cwd: Cwd,
  env: Env,
  terminal: Terminal,
  args: Array<CliArg>,
): Promise<number> {
  if (args.length > 0) {
    terminal.writeToStderrMakesALotOfSenseHere(
      `${bold("elm-watch try-open")} takes no arguments.`,
    );
    return 1;
  }

  const value = env[ELM_WATCH_OPEN_EDITOR];
  if (value === undefined || value === "") {
    terminal.writeToStderrMakesALotOfSenseHere(
      Errors.tryOpenEnvNotSet(getCommandHint(env)),
    );
    return 1;
  }

  const file = findClosest("package.json", cwd);
  if (file === undefined) {
    terminal.writeToStderrMakesALotOfSenseHere(
      Errors.tryOpenNoPackageJson(cwd),
    );
    return 1;
  }

  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    terminal.writeToStderrMakesALotOfSenseHere(
      Errors.tryOpenReadError(file, error),
    );
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
    Errors.tryOpenOpening(
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

  return 0;
}
