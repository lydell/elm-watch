import * as childProcess from "child_process";

import type { OpenEditorError } from "../client/WebSocketMessages.ts";
import type { OpenEditorFunction } from "./Config.ts";
import { __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS, type Env } from "./Env.ts";
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
  if (projectOpenEditor.tag === "NotSet") {
    onError({ tag: "EnvNotSet" });
  } else if (
    !projectHasFilePathThatCanBeOpenedInEditor(project, location.file)
  ) {
    onError({
      tag: "InvalidFilePath",
      message: Errors.openEditorInvalidFilePath(location.file),
    });
  } else {
    switch (projectOpenEditor.tag) {
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

export function printOpenEditorErrorForTerminal(
  error: OpenEditorError,
): string {
  switch (error.tag) {
    case "EnvNotSet":
      return Errors.openEditorEnvNotSetForTerminal();
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
