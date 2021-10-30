import { ErrorTemplate } from "./Errors";
import { CLEAR, Env, removeColor, WriteStream } from "./Helpers";
import { IS_WINDOWS } from "./IsWindows";

export type Logger = {
  handleColor: (string: string) => string;
  log: (message: string) => void;
  error: (message: string) => void;
  errorTemplate: (template: ErrorTemplate) => void;
  clearScreen: () => void;
  fancy: boolean;
  raw: {
    NO_COLOR: boolean;
    stdout: WriteStream;
    stderr: WriteStream;
    stderrColumns: number;
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

  // `.columns` is `undefined` if not a TTY.
  const stderrColumns = stderr.columns ?? 80;

  return {
    handleColor,
    log(message) {
      stdout.write(`${handleColor(message)}\n`);
    },
    error(message) {
      stderr.write(`${handleColor(message)}\n`);
    },
    errorTemplate(template) {
      stderr.write(`${handleColor(template(stderrColumns))}\n`);
    },
    clearScreen(): void {
      if (stderr.isTTY) {
        stderr.write(CLEAR);
      }
    },
    fancy: !IS_WINDOWS && !NO_COLOR,
    raw: {
      NO_COLOR,
      stdout,
      stderr,
      stderrColumns,
    },
  };
}
