import * as childProcess from "child_process";

import type {
  OpenEditorError,
  OpenEditorEnv,
  WebSocketToClientMessage,
} from "../client/WebSocketMessages.ts";
import { editorUrl, isEditorUrl, validateEditorUrlTemplate } from "./Editor.ts";
import { __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS, type Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import { bold, silentlyReadIntEnvValue } from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import {
  type Project,
  projectHasFilePathThatCanBeOpenedInEditor,
} from "./Project.ts";
import { killWindowsProcessTree } from "./Spawn.ts";
import type { AbsolutePath } from "./Types.ts";

type OpenEditorLocation = {
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
  // With no editor set up, the browser and the terminal show the editor
  // chooser instead of asking us to open anything.
  if (projectOpenEditor.tag === "NotSet" && project.editor === undefined) {
    return;
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
    const onEnvDone = (error: OpenEditorError | undefined): void => {
      if (error !== undefined) {
        onError({
          ...error,
          message: `${error.message}\n\n${Errors.openEditorTryEnvHint()}`,
        });
      }
    };
    // A chosen preset takes precedence over `ELM_WATCH_OPEN_EDITOR`, so that
    // you can use a preset in some projects, and your custom editor in others.
    if (project.editor !== undefined) {
      openEditorWithUrl(
        env,
        location,
        project.editor.template,
        "Preset",
        onDone,
      );
      return;
    }
    switch (projectOpenEditor.tag) {
      case "NotSet":
        return;

      case "Url":
        openEditorWithUrl(
          env,
          location,
          projectOpenEditor.template,
          "Env",
          onEnvDone,
        );
        return;

      case "Command":
        openEditorWithCommand(
          env,
          project.root,
          location,
          projectOpenEditor.command,
          onEnvDone,
        );
        return;
    }
  }
}

export function getOpenEditorSetupMessage(
  project: Project,
): WebSocketToClientMessage {
  return {
    tag: "OpenEditorSetupChanged",
    preset: project.editor?.id ?? null,
    env: getOpenEditorEnv(project),
  };
}

function getOpenEditorEnv(project: Project): OpenEditorEnv | null {
  switch (project.openEditor.tag) {
    case "NotSet":
      return null;

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

export function printOpenEditorErrorForTerminal(
  error: OpenEditorError,
): string {
  return `${bold("Opening the location in your editor failed!")}\n\n${error.message}`;
}

// For `elm-watch editor`: Open the location using `ELM_WATCH_OPEN_EDITOR`
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
