import * as childProcess from "child_process";
import * as path from "path";

import type {
  OpenEditorError,
  WebSocketToClientMessage,
} from "../client/WebSocketMessages.ts";
import type { OpenEditorFunction } from "./Config.ts";
import { type Editor, editorToString, editorUrl } from "./Editor.ts";
import {
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  type Env,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import {
  bold,
  silentlyReadIntEnvValue,
  unknownErrorToString,
} from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import {
  type OpenEditorCommandSource,
  type Project,
  projectHasFilePathThatCanBeOpenedInEditor,
} from "./Project.ts";
import { killWindowsProcessTree } from "./Spawn.ts";
import type { AbsolutePath } from "./Types.ts";

export type OpenEditorLocation = {
  file: AbsolutePath;
  line: number;
  column: number;
};

export function openEditor(
  env: Env,
  project: Project,
  location: OpenEditorLocation,
  onError: (error: OpenEditorError) => void,
): void {
  const { openEditor: projectOpenEditor } = project;
  if (projectOpenEditor.tag === "NotSet" && project.editor === undefined) {
    onError({ tag: "EnvNotSet", commandHint: getCommandHint(env, project) });
  } else if (
    !projectHasFilePathThatCanBeOpenedInEditor(project, location.file)
  ) {
    onError({
      tag: "InvalidFilePath",
      message: Errors.openEditorInvalidFilePath(location.file),
    });
  } else {
    switch (projectOpenEditor.tag) {
      case "NotSet":
        if (project.editor !== undefined) {
          openEditorWithUrl(env, location, project.editor, onError);
        }
        return;

      case "Command":
        openEditorWithCommand(
          env,
          project,
          location,
          projectOpenEditor,
          onError,
        );
        return;
      case "Function":
        openEditorWithFunction(location, projectOpenEditor.openEditor, onError);
        return;
    }
  }
}

export function getOpenEditorSetupMessage(
  env: Env,
  project: Project,
): WebSocketToClientMessage {
  return {
    tag: "OpenEditorSetupChanged",
    setup:
      project.openEditor.tag !== "NotSet"
        ? { tag: "Server" }
        : project.editor === undefined
          ? { tag: "NotSet" }
          : { tag: "Url", editor: editorToString(project.editor) },
    commandHint: getCommandHint(env, project),
  };
}

// How to set `ELM_WATCH_OPEN_EDITOR` in the user’s shell. The environment
// variable is only used with elm-watch.json.
export function getCommandHint(env: Env, project: Project): string | null {
  if (project.configSource.tag !== "ElmWatchJson") {
    return null;
  }
  if (IS_WINDOWS) {
    return `# System Settings > Environment Variables\n${ELM_WATCH_OPEN_EDITOR}=your-editor "%file%:%line%:%column%"`;
  }
  const shell = path.basename(env["SHELL"] ?? "");
  switch (shell) {
    case "fish":
      return `# Run once:\nset -Ux ${ELM_WATCH_OPEN_EDITOR} 'your-editor "$file:$line:$column"'`;
    case "bash":
    case "zsh":
      return `# ~/.${shell}rc\nexport ${ELM_WATCH_OPEN_EDITOR}='your-editor "$file:$line:$column"'`;
    default:
      return `# Your shell’s config file\nexport ${ELM_WATCH_OPEN_EDITOR}='your-editor "$file:$line:$column"'`;
  }
}

export function printOpenEditorErrorForTerminal(
  error: OpenEditorError,
): string {
  switch (error.tag) {
    case "EnvNotSet":
      return Errors.openEditorEnvNotSetForTerminal(error.commandHint);
    case "InvalidFilePath":
    case "CommandFailed":
      return `${bold("Opening the location in your editor failed!")}\n\n${error.message}`;
  }
}

function openEditorWithCommand(
  env: Env,
  project: Project,
  location: OpenEditorLocation,
  { command, source }: { command: string; source: OpenEditorCommandSource },
  onError: (error: OpenEditorError) => void,
): void {
  const cwd = project.root;
  const timeout = silentlyReadIntEnvValue(
    env[__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS],
    5000,
  );
  const extraEnv = {
    file: location.file,
    line: location.line.toString(),
    column: location.column.toString(),
    // For editors that count from 0, since subtracting is not easy in cmd.exe.
    line0: Math.max(0, location.line - 1).toString(),
    column0: Math.max(0, location.column - 1).toString(),
  };
  let timedOut = false;
  const child = childProcess.exec(
    command,
    {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    },
    (error, stdout, stderr) => {
      clearTimeout(timeoutId);
      if (error !== null) {
        onError({
          tag: "CommandFailed",
          message: Errors.openEditorCommandFailed({
            error,
            command,
            source,
            cwd,
            timeout: timedOut ? timeout : undefined,
            env: extraEnv,
            stdout,
            stderr,
          }),
        });
      }
    },
  );
  // Not using the `timeout` option of `exec`, since it only kills the shell,
  // not the command, on Windows.
  const timeoutId = setTimeout(() => {
    timedOut = true;
    if (IS_WINDOWS && child.pid !== undefined) {
      killWindowsProcessTree(child.pid, { sync: false });
    } else {
      child.kill();
    }
  }, timeout);
}

// Used from the terminal. The browser opens the URL by itself.
function openEditorWithUrl(
  env: Env,
  location: OpenEditorLocation,
  editor: Editor,
  onError: (error: OpenEditorError) => void,
): void {
  const url = editorUrl(editor, location);
  const timeout = silentlyReadIntEnvValue(
    env[__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS],
    5000,
  );
  const [command, ...args] = getOpenUrlCommand(url);
  childProcess.execFile(
    command,
    args,
    { env, encoding: "utf8", timeout },
    (error, stdout, stderr) => {
      if (error !== null) {
        onError({
          tag: "CommandFailed",
          message: Errors.openEditorUrlFailed({
            error,
            command: [command, ...args],
            timeout: error.killed === true ? timeout : undefined,
            stdout,
            stderr,
          }),
        });
      }
    },
  );
}

// No shell is involved, so the URL does not need escaping.
function getOpenUrlCommand(url: string): [string, ...Array<string>] {
  switch (process.platform) {
    case "darwin":
      return ["open", url];
    case "win32":
      return ["rundll32.exe", "url.dll,FileProtocolHandler", url];
    default:
      return ["xdg-open", url];
  }
}

function openEditorWithFunction(
  { file, line, column }: OpenEditorLocation,
  openEditorFunction: OpenEditorFunction,
  onError: (error: OpenEditorError) => void,
): void {
  const location = { file, line, column };
  new Promise((resolve) => {
    resolve(openEditorFunction(location));
  }).catch((error: unknown) => {
    onError({
      tag: "CommandFailed",
      message: Errors.openEditorFunctionFailed(
        location,
        unknownErrorToString(error),
      ),
    });
  });
}
