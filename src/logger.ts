import { Env, removeColor, WriteStream } from "./helpers";

export type Logger = {
  handleColor: (string: string) => string;
  log: (message: string) => void;
  error: (message: string) => void;
  raw: {
    NO_COLOR: boolean;
    stdout: WriteStream;
    stderr: WriteStream;
  };
};

export function makeLogger({
  env,
  stdout,
  stderr,
}: {
  env: Env;
  stdout: WriteStream;
  stderr: WriteStream;
}): Logger {
  const NO_COLOR = "NO_COLOR" in env;
  const handleColor = (string: string): string =>
    NO_COLOR ? removeColor(string) : string;

  return {
    handleColor,
    log(message) {
      stdout.write(`${handleColor(message)}\n`);
    },
    error(message) {
      stderr.write(`${handleColor(message)}\n`);
    },
    raw: {
      NO_COLOR,
      stdout,
      stderr,
    },
  };
}
