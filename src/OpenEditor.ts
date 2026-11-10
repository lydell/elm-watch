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
import {
  type Project,
  projectHasFilePathThatCanBeOpenedInEditor,
} from "./Project.ts";
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
          projectOpenEditor.command,
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
  command: string,
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
  };
  childProcess.exec(
    command,
    {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
      timeout,
    },
    (error, stdout, stderr) => {
      if (error !== null) {
        onError({
          tag: "CommandFailed",
          message: Errors.openEditorCommandFailed({
            error,
            command,
            cwd,
            timeout,
            env: extraEnv,
            stdout,
            stderr,
          }),
        });
      }
    },
  );
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
