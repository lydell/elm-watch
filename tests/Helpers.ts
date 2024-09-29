import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as os from "os";
import * as path from "path";
import * as stream from "stream";
import * as url from "url";

import { EMOJI } from "../src/Compile";
import {
  __ELM_WATCH_LOADING_MESSAGE_DELAY,
  __ELM_WATCH_MAX_PARALLEL,
  __ELM_WATCH_MOCKED_TIMINGS,
  __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS,
  __ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  Env,
  WT_SESSION,
} from "../src/Env";
import { printStdio } from "../src/Errors";
import { ReadStream, toError, WriteStream } from "../src/Helpers";
import { IS_WINDOWS } from "../src/IsWindows";

toError.jestWorkaround = (arg: unknown): NodeJS.ErrnoException => arg as Error;

const { JEST_RETRIES } = process.env;
if (JEST_RETRIES !== undefined) {
  jest.retryTimes(Number(JEST_RETRIES), { logErrorsBeforeRetry: true });
}

// Print date and time in UTC in snapshots.
/* eslint-disable @typescript-eslint/unbound-method */
Date.prototype.getFullYear = Date.prototype.getUTCFullYear;
Date.prototype.getMonth = Date.prototype.getUTCMonth;
Date.prototype.getDate = Date.prototype.getUTCDate;
Date.prototype.getHours = Date.prototype.getUTCHours;
Date.prototype.getMinutes = Date.prototype.getUTCMinutes;
Date.prototype.getSeconds = Date.prototype.getUTCSeconds;
/* eslint-enable @typescript-eslint/unbound-method */

// This uses `console` rather than `process.stdout` so Jest can capture it.
// And `.log` instead of `.error`, because Jest colors `.error` red.
// eslint-disable-next-line no-console
export const logDebug = console.log;

// Read file with normalized line endings to make snapshotting easier
// cross-platform.
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

export const TEST_ENV = {
  [ELM_WATCH_OPEN_EDITOR]: undefined,
  [__ELM_WATCH_LOADING_MESSAGE_DELAY]: "0",
  [__ELM_WATCH_MAX_PARALLEL]: "2",
  [__ELM_WATCH_MOCKED_TIMINGS]: "",
  [__ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS]: "100000",
  [__ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS]: "0",
  [WT_SESSION]: "",
};

export function badElmBinEnv(dir: string): Env {
  return {
    ...process.env,
    ...TEST_ENV,
    PATH: prependPATH(dir),
    // The default timeout is optimized for calling Elm directly.
    // The bad-bin `elm`s are Node.js scripts – just starting Node.js can take
    // 100ms. So raise the bar to stabilize the tests.
    [__ELM_WATCH_LOADING_MESSAGE_DELAY]: "10000",
  };
}

export function prependPATH(folder: string): string {
  // On Windows, create an `elm.cmd` next to fake `elm` binaries. Files without
  // extensions aren’t executable, but .cmd files are. The `elm.cmd` files
  // execute the `elm` file next to them using `node`.
  if (IS_WINDOWS && fs.existsSync(path.join(folder, "elm"))) {
    fs.writeFileSync(
      path.join(folder, "elm.cmd"),
      `@echo off\r\nnode "%~dp0\\elm" %*`,
    );
  }
  return `${folder}${path.delimiter}${process.env.PATH ?? ""}`;
}

export async function waitOneFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export function touch(filePath: string): void {
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

export function rm(filePath: string): void {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      fs.rmdirSync(filePath);
    }
  }
}

// This is async because of Windows. `fs.rmSync` seems to sometimes fail with
// “permission denied” `lstat` errors. The async version does not seem to have
// that issue, possibly because all the filesystem calls get a little bit more
// spread out.
export async function rimraf(filePath: string): Promise<void> {
  await fs.promises.rm(filePath, { recursive: true, force: true });
}

export function rmSymlink(symlink: string): void {
  // Can’t use the `rm` function here, since `fs.existsSync(symlink)` returns
  // `false` if `symlink` is an existing symlink but points to a non-existing file.
  try {
    fs.unlinkSync(symlink);
  } catch {
    // Does not exist.
  }
}

export class SilentReadStream extends stream.Readable implements ReadStream {
  isTTY = true;

  isRaw = false;

  data: Array<string> = [];

  override _read(): void {
    this.push(this.data.shift());
  }

  setRawMode(isRaw: boolean): void {
    this.isRaw = isRaw;
  }
}

export class TerminalColorReadStream
  extends SilentReadStream
  implements ReadStream
{
  override on<T>(
    eventName: string | symbol,
    listener: (...args: Array<T>) => void,
  ): this {
    if (eventName === "data" && this.isRaw) {
      this.data.push(
        ...Array.from({ length: 16 }, (_, i) => {
          const hex = i.toString(16).toUpperCase().repeat(4);
          return `\x1B]4;${i};rgb:${hex}/${hex}/${hex}${
            i % 2 === 0 ? "\x07" : "\x1B\\"
          }`;
        }),
        "\x1B]10;rgb:1111/2222/3333\x07",
        "\x1B]11;rgb:aaaa/bbbb/cccc\x1B\\",
      );
      this._read();
    }
    return super.on(eventName, listener);
  }
}

export class CtrlCReadStream extends SilentReadStream implements ReadStream {
  ctrlC(): void {
    this.data.push("\x03");
    this._read();
  }
}

export class MemoryWriteStream extends stream.Writable implements WriteStream {
  isTTY = true;

  columns = undefined;

  content = "";

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.content += removeTerminalColorRequests(chunk.toString());
    callback();
  }
}

const SPLIT_REGEX = /(\n|\x1B\[\d*(?:;\d*)?[A-Z])/;
const ESCAPE_REGEX = /\x1B\[(\d*)(?:;(\d*))?([A-Z])/;
const COLOR_REGEX = /(\x1B\[\d*m)/g;

type Escape =
  | {
      tag: "ClearLineFull";
    }
  | {
      tag: "ClearLineToEnd";
    }
  | {
      tag: "ClearLineToStart";
    }
  | {
      tag: "ClearScreenFull";
    }
  | {
      tag: "ClearScreenFullAndScrollback";
    }
  | {
      tag: "ClearScreenToEnd";
    }
  | {
      tag: "ClearScreenToStart";
    }
  | {
      tag: "CursorMove";
      dx: number;
      dy: number;
    }
  | {
      tag: "CursorTo";
      x: number;
      y: number;
    }
  | {
      tag: "CursorToHorizontal";
      x: number;
    };

function parseEscape(
  char: string,
  num1: number | undefined,
  num2: number | undefined,
): Escape {
  switch (char) {
    case "A":
      return { tag: "CursorMove", dx: 0, dy: -(num1 ?? 1) };

    case "B":
      return { tag: "CursorMove", dx: 0, dy: num1 ?? 1 };

    case "C":
      return { tag: "CursorMove", dx: num1 ?? 1, dy: 0 };

    case "D":
      return { tag: "CursorMove", dx: -(num1 ?? 1), dy: 0 };

    case "G":
      return { tag: "CursorToHorizontal", x: (num1 ?? 1) - 1 };

    case "H":
      return { tag: "CursorTo", x: (num1 ?? 1) - 1, y: (num2 ?? 1) - 1 };

    case "J":
      switch (num1 ?? 0) {
        case 0:
          return { tag: "ClearScreenToEnd" };

        case 1:
          return { tag: "ClearScreenToStart" };

        case 2:
          return { tag: "ClearScreenFull" };

        case 3:
          return { tag: "ClearScreenFullAndScrollback" };

        default:
          throw new Error(`Unknown clear screen: ${num1 ?? 0}J`);
      }

    case "K":
      switch (num1 ?? 0) {
        case 0:
          return { tag: "ClearLineToEnd" };

        case 1:
          return { tag: "ClearLineToStart" };

        case 2:
          return { tag: "ClearLineFull" };

        default:
          throw new Error(`Unknown clear line: ${num1 ?? 0}K`);
      }

    default:
      throw new Error(`Unknown escape move char: ${char}`);
  }
}

function toNumber(subMatch: string | undefined): number | undefined {
  return subMatch === undefined || subMatch === ""
    ? undefined
    : Number(subMatch);
}

function stringLength(string: string): number {
  // https://unicode.org/emoji/charts/emoji-variants.html
  return Array.from(string.replace(/\ufe0f/g, "")).length;
}

function colorAwareSlice(
  string: string,
  start: number,
  end: number = string.length,
): string {
  let result = "";
  let index = 0;
  for (const [i, part] of string.split(COLOR_REGEX).entries()) {
    if (i % 2 === 0) {
      for (const char of Array.from(part)) {
        if (index >= start && index < end) {
          result += char;
        }
        if (char !== "\ufe0f") {
          index++;
        }
      }
    } else if (
      start === 0 && end === 0
        ? false
        : start === 0
          ? index >= 0 && index <= end
          : index > start && index <= end
    ) {
      result += part;
    }
  }
  return result;
}

export class CursorWriteStream extends stream.Writable implements WriteStream {
  isTTY = true;

  columns = 80;

  private lines: Array<string> = [];

  private cursor = { x: 0, y: 0 };

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const parts = removeTerminalColorRequests(chunk.toString()).split(
      SPLIT_REGEX,
    );
    for (const part of parts) {
      switch (part) {
        case "":
          // Do nothing.
          break;

        case "\n":
          this.cursor = { x: 0, y: this.cursor.y + 1 };
          break;

        default: {
          const match = ESCAPE_REGEX.exec(part);

          if (match !== null) {
            const escape = parseEscape(
              match[3] as string,
              toNumber(match[1]),
              toNumber(match[2]),
            );

            switch (escape.tag) {
              case "ClearLineFull":
                this.lines[this.cursor.y] = "";
                break;

              case "ClearLineToEnd":
                this.lines[this.cursor.y] = colorAwareSlice(
                  this.lines[this.cursor.y] ?? "",
                  0,
                  this.cursor.x,
                );
                break;

              case "ClearLineToStart":
                this.lines[this.cursor.y] = colorAwareSlice(
                  this.lines[this.cursor.y] ?? "",
                  this.cursor.x,
                );
                break;

              case "ClearScreenFull":
                this.lines = this.lines.map(() => "");
                break;

              case "ClearScreenFullAndScrollback":
                this.lines = [];
                break;

              case "ClearScreenToEnd":
                this.lines = this.lines.map((line, index) =>
                  index < this.cursor.y
                    ? line
                    : index === this.cursor.y
                      ? colorAwareSlice(line, 0, this.cursor.x)
                      : "",
                );
                break;

              case "ClearScreenToStart":
                this.lines = this.lines.map((line, index) =>
                  index < this.cursor.y
                    ? ""
                    : index === this.cursor.y
                      ? " ".repeat(this.cursor.x + 1) +
                        colorAwareSlice(line, this.cursor.x + 1)
                      : line,
                );
                break;

              case "CursorMove": {
                const { dx, dy } = escape;
                const cursor = { x: this.cursor.x + dx, y: this.cursor.y + dy };
                if (cursor.x < 0 || cursor.y < 0) {
                  callback(
                    new Error(
                      `Cursor out of bounds: ${JSON.stringify(
                        this.cursor,
                      )} + ${JSON.stringify({ dx, dy })} = ${JSON.stringify(
                        cursor,
                      )}`,
                    ),
                  );
                  return;
                } else {
                  this.cursor = cursor;
                }
                break;
              }

              case "CursorTo":
                this.cursor = { x: escape.x, y: escape.y };
                break;

              case "CursorToHorizontal":
                this.cursor.x = escape.x;
                break;
            }
          } else {
            const yDiff = this.cursor.y - this.lines.length + 1;
            if (yDiff > 0) {
              this.lines.push(...Array.from({ length: yDiff }, () => ""));
            }
            const line = this.lines[this.cursor.y] ?? "";
            const xDiff =
              this.cursor.x - stringLength(line.replace(COLOR_REGEX, ""));
            const paddedLine = xDiff > 0 ? line + " ".repeat(xDiff) : line;
            const partLength = stringLength(part.replace(COLOR_REGEX, ""));
            const nextLine =
              colorAwareSlice(paddedLine, 0, this.cursor.x) +
              part +
              colorAwareSlice(paddedLine, this.cursor.x + partLength);
            this.lines[this.cursor.y] = nextLine;
            this.cursor = { x: this.cursor.x + partLength, y: this.cursor.y };
          }
        }
      }
    }
    callback();
  }

  getOutput(): string {
    // Emoji take two columns, but the above code doesn’t understand that.
    // This is a hack to remove the extra space caused by that in snapshots.
    return this.lines.join("\n").replace(
      RegExp(
        `(${Object.values(EMOJI)
          .map(({ emoji }) => emoji)
          .join("|")})  `,
        "g",
      ),
      "$1 ",
    );
  }

  resize(columns: number): void {
    this.columns = columns;
    this.emit("resize");
  }
}

function removeTerminalColorRequests(string: string): string {
  return string.replace(/\x1B\][^\x1B]+\x1B\\/g, "");
}

export function clean(string: string): string {
  const { root } = path.parse(__dirname);

  const project = path.join(root, "Users", "you", "project");

  // Replace start of absolute paths with hardcoded stuff so the tests pass on
  // more than one computer. Replace automatic port numbers with a fixed one.
  // Replace colors for snapshots. Replace backslashes with slashes for Windows
  // That can be extra tricky since we sometimes print JSON strings where the
  // backslashes end up escaped with another backslash. Normalize some error
  // messages between Windows and others, and between Node.js versions.
  return string
    .split(path.dirname(__dirname))
    .join(project)
    .split(path.dirname(__dirname).replace(/\\/g, "\\\\"))
    .join(project)
    .split(url.pathToFileURL(path.dirname(__dirname)).toString())
    .join(
      url
        .pathToFileURL(project)
        .toString()
        .replace(/[A-Z]:\//g, ""),
    )
    .split(os.tmpdir())
    .join(path.join(root, "tmp", "fake"))
    .replace(/(ws:\/\/0\.0\.0\.0):\d{5}/g, "$1:59123")
    .replace(/(?:\x1B\[0?m)?\x1B\[(?!0)\d+m/g, "⧙")
    .replace(/\x1B\[0?m/g, "⧘")
    .replace(
      /[A-Z]:\\(\S+)/g,
      (_match, rest: string) =>
        `/${rest.replace(/\\\\/g, "/").replace(/\\/g, "/")}`,
    )
    .replace(/(\bcd|--output=\/dev\/null) '([^'\s]+)'/g, "$1 $2")
    .replace(/'(--output=[^'\s]+)' '([^'\s]+)'/g, "$1 $2")
    .replace(
      /Expected .+ in JSON at position \d+|Unexpected token . in JSON at position \d+|Unexpected end of JSON input/g,
      "(JSON syntax error)",
    )
    .replace(/(EISDIR: illegal operation on a directory, read) '.+/g, "$1")
    .replace(/EPERM: operation not permitted/g, "EACCES: permission denied")
    .replace(/EOF/g, "EPIPE");
}

export function assertExitCode(
  expectedExitCode: number,
  actualExitCode: number,
  stdout: string,
  stderr: string,
): void {
  if (expectedExitCode !== actualExitCode) {
    throw new Error(
      `
exit ${actualExitCode} (expected ${expectedExitCode})

${printStdio(stdout, stderr)(process.stdout.columns, (piece) => piece.text)}
      `.trim(),
    );
  }
}

// Make snapshots easier to read.
// Before: `"\\"string\\""`
// After: `"string"`
export const stringSnapshotSerializer = {
  test: (value: unknown): boolean => typeof value === "string",
  print: String,
};

// For things like symlinks and readonly files/folders that aren’t really a thing on Windows.
export const describeExceptWindows = IS_WINDOWS ? describe.skip : describe;
export const testExceptWindows = IS_WINDOWS ? test.skip : test;

export async function httpGet(
  urlString: string,
  options: http.RequestOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    (urlString.startsWith("https:") ? https : http)
      .get(urlString, { ...options, rejectUnauthorized: false }, (res) => {
        const chunks: Array<Buffer> = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString();
          if (res.statusCode === 200) {
            resolve(body);
          } else {
            reject(
              new Error(
                `GET ${urlString} – expected status code 200 but got ${
                  res.statusCode ?? "(no status code)"
                }:\n\n${body}`,
              ),
            );
          }
        });
      })
      .on("error", reject);
  });
}
