import * as Codec from "tiny-decoders";

// For the `openEditor` option: Runs a shell command like the
// `ELM_WATCH_OPEN_EDITOR` environment variable does, so that users of the
// JavaScript API don’t have to implement running commands themselves.
export type ShellCommand = {
  readonly command: string;
};

const shellCommands = new WeakSet<ShellCommand>();

export function shellCommand(command: unknown): ShellCommand {
  if (typeof command !== "string" || command.trim() === "") {
    throw new TypeError(
      `shellCommand: Expected a non-empty string, but got: ${Codec.repr(command)}`,
    );
  }
  const value: ShellCommand = Object.freeze({ command });
  shellCommands.add(value);
  return value;
}

export function isShellCommand(value: unknown): value is ShellCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    shellCommands.has(value as ShellCommand)
  );
}
