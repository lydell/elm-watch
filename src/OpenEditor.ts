import * as childProcess from "child_process";
import * as path from "path";

import type {
  OpenEditorError,
  OpenEditorSetup,
  WebSocketToClientMessage,
} from "../client/WebSocketMessages.ts";
import {
  EDITOR_PLACEHOLDERS,
  EDITOR_URL_EXAMPLE,
  editorUrl,
  isEditorUrl,
  validateEditorUrlTemplate,
} from "./Editor.ts";
import {
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  type Env,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import {
  bold,
  silentlyReadIntEnvValue,
} from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import {
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
    onError({ tag: "EnvNotSet", commandHint: getCommandHint(env) });
  } else if (
    !projectHasFilePathThatCanBeOpenedInEditor(project, location.file)
  ) {
    onError({
      tag: "InvalidFilePath",
      message: Errors.openEditorInvalidFilePath(location.file),
    });
  } else {
    const onDone = (error: OpenEditorError | undefined): void => {
      if (error !== undefined) {
        onError(error);
      }
    };
    switch (projectOpenEditor.tag) {
      case "NotSet":
        if (project.editor !== undefined) {
          openEditorWithUrl(
            env,
            location,
            project.editor.template,
            "Preset",
            onDone,
          );
        }
        return;

      case "Url":
        openEditorWithUrl(
          env,
          location,
          projectOpenEditor.template,
          "Env",
          onDone,
        );
        return;

      case "Command":
        openEditorWithCommand(
          env,
          project.root,
          location,
          projectOpenEditor.command,
          onDone,
        );
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
    setup: getOpenEditorSetup(project),
    commandHint: getCommandHint(env),
  };
}

function getOpenEditorSetup(project: Project): OpenEditorSetup {
  switch (project.openEditor.tag) {
    case "NotSet":
      return project.editor === undefined
        ? { tag: "NotSet" }
        : { tag: "Preset", editor: project.editor.id };

    case "Url":
      // Let the server show the error for invalid URLs.
      return validateEditorUrlTemplate(project.openEditor.template) ===
        undefined
        ? { tag: "Url", template: project.openEditor.template }
        : { tag: "Server" };

    case "Command":
      return { tag: "Server" };
  }
}

// How to set `ELM_WATCH_OPEN_EDITOR` in the user’s shell: To a URL or a
// command.
export function getCommandHint(env: Env): string {
  const urlComment = `A URL (${EDITOR_PLACEHOLDERS.join(" ")}):`;
  const commandComment = (variables: Array<string>): string =>
    `Or a command (${variables.join(" ")}):`;
  const variableNames = EDITOR_PLACEHOLDERS.map((placeholder) =>
    placeholder.slice(1, -1),
  );
  if (IS_WINDOWS) {
    return [
      "# System Settings > Environment Variables",
      `# ${urlComment}`,
      `${ELM_WATCH_OPEN_EDITOR}=${EDITOR_URL_EXAMPLE}`,
      `# ${commandComment(variableNames.map((name) => `%${name}%`))}`,
      `${ELM_WATCH_OPEN_EDITOR}=your-editor "%file%:%line%:%column%"`,
    ].join("\n");
  }
  const [comment, set] = getShellConfig(path.basename(env["SHELL"] ?? ""));
  return [
    `# ${comment}`,
    `# ${urlComment}`,
    set(`'${EDITOR_URL_EXAMPLE}'`),
    `# ${commandComment(variableNames.map((name) => `$${name}`))}`,
    set(`'your-editor "$file:$line:$column"'`),
  ].join("\n");
}

function getShellConfig(
  shell: string,
): [comment: string, set: (quotedValue: string) => string] {
  const exportValue = (quotedValue: string): string =>
    `export ${ELM_WATCH_OPEN_EDITOR}=${quotedValue}`;
  switch (shell) {
    case "fish":
      return [
        "Run once:",
        (quotedValue) => `set -Ux ${ELM_WATCH_OPEN_EDITOR} ${quotedValue}`,
      ];
    case "bash":
    case "zsh":
      return [`~/.${shell}rc`, exportValue];
    default:
      return ["Your shell’s config file", exportValue];
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

// For `elm-watch try-open`: Open the location using `ELM_WATCH_OPEN_EDITOR`
// (set to a URL or a command), and wait for the result.
export async function openEditorFromEnv(
  env: Env,
  cwd: AbsolutePath,
  location: OpenEditorLocation,
  value: string,
): Promise<OpenEditorError | undefined> {
  return new Promise((resolve) => {
    if (isEditorUrl(value)) {
      openEditorWithUrl(env, location, value, "Env", resolve);
    } else {
      openEditorWithCommand(env, cwd, location, value, resolve);
    }
  });
}

function openEditorWithCommand(
  env: Env,
  cwd: AbsolutePath,
  location: OpenEditorLocation,
  command: string,
  onDone: (error: OpenEditorError | undefined) => void,
): void {
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
      if (error === null) {
        onDone(undefined);
      } else {
        onDone({
          tag: "CommandFailed",
          message: Errors.openEditorCommandFailed({
            error,
            command,
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

// Used from the terminal. The browser opens the URL by itself (unless invalid).
function openEditorWithUrl(
  env: Env,
  location: OpenEditorLocation,
  template: string,
  source: "Preset" | "Env",
  onDone: (error: OpenEditorError | undefined) => void,
): void {
  const invalidReason = validateEditorUrlTemplate(template);
  if (invalidReason !== undefined) {
    onDone({
      tag: "CommandFailed",
      message: Errors.openEditorInvalidUrl(template, invalidReason),
    });
    return;
  }
  const url = editorUrl(template, location);
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
      if (error === null) {
        onDone(undefined);
      } else {
        onDone({
          tag: "CommandFailed",
          message: Errors.openEditorUrlFailed({
            error,
            command: [command, ...args],
            source,
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
