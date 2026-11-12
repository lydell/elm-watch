import type { Readable, Writable } from "stream";
import * as Codec from "tiny-decoders";

import type { NonEmptyArray } from "./NonEmptyArray.ts";

export type ReadStream = Readable & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = Writable & {
  isTTY: boolean;
  columns?: number;
  rows?: number;
};

export function split(string: string, splitter: string): NonEmptyArray<string> {
  return string.split(splitter) as NonEmptyArray<string>;
}

export function getSetSingleton<T>(set: Set<T>): T | undefined {
  return set.size === 1 ? Array.from(set)[0] : undefined;
}

// https://github.com/contour-terminal/vt-extensions/blob/master/synchronized-output.md
export const BEGIN_SYNC_UPDATE = "\x1B[?2026h";
export const END_SYNC_UPDATE = "\x1B[?2026l";

export const CLEAR = "\x1B[2J\x1B[3J\x1B[H";
export const HIDE_CURSOR = "\x1B[?25l";
export const SHOW_CURSOR = "\x1B[?25h";
export const RESET_COLOR = "\x1B[0m";

export function bold(string: string): string {
  return `${RESET_COLOR}\x1B[1m${string}${RESET_COLOR}`;
}

export function dim(string: string): string {
  return `${RESET_COLOR}\x1B[2m${string}${RESET_COLOR}`;
}

// Matches what to remove from text from the outside (like error messages from
// other tools), so that it can’t mess up the terminal: Whole CSI and OSC escape
// sequences, and control characters except tab and newline. Anything a
// terminal acts on starts with a control character, so if some other kind of
// escape sequence slips through, only harmless text is left of it. Colors
// (SGR, a kind of CSI) are kept, though.
const UNSAFE_TERMINAL_TEXT =
  /\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]|\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)|[\x00-\x08\x0B-\x1F\x7F-\x9F]/g;

const SGR = /\x1B\[[\d;:]*m/g;
const ONLY_SGR = /^\x1B\[[\d;:]*m$/;

export function removeColor(string: string): string {
  return string.replace(SGR, "");
}

// Returns the text with colors (reset at the end, so they can’t leak), and the
// text without colors.
export function sanitizeTerminalText(string: string): {
  withColor: string;
  plain: string;
} {
  const withColor = string
    .replace(/\r\n/g, "\n")
    .replace(UNSAFE_TERMINAL_TEXT, (match) =>
      ONLY_SGR.test(match) ? match : "",
    );
  const plain = withColor.replace(SGR, "");
  return {
    withColor: plain === withColor ? plain : `${withColor}${RESET_COLOR}`,
    plain,
  };
}

export function cursorHorizontalAbsolute(n: number): string {
  return `\x1B[${n}G`;
}

function pad(number: number): string {
  return number.toString().padStart(2, "0");
}

export function quote(string: string): string {
  return Codec.JSON.stringify(Codec.string, string);
}

export function formatDate(date: Date): string {
  return [
    pad(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

export function formatTime(date: Date): string {
  return [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join(":");
}

const KiB = 1024;
const MiB = 1048576;

export function printFileSize(fileSize: number): string {
  const [divided, unit] =
    fileSize >= MiB ? [fileSize / MiB, "MiB"] : [fileSize / KiB, "KiB"];
  const string = toFixed(divided).padStart(4, " ");
  return `${string} ${unit}`;
}

const SECOND = 1000;

export function printDurationMs(durationMs: number): string {
  const divided = durationMs / SECOND;
  const [string, unit] =
    durationMs < SECOND
      ? [durationMs.toString(), "ms"]
      : [toFixed(divided), "s"];
  return `${string} ${unit}`.padStart(6, " ");
}

function toFixed(n: number): string {
  const s1 = n.toFixed(2);
  if (s1.length <= 4) {
    return s1;
  }

  const s2 = n.toFixed(1);
  if (s2.length <= 4) {
    return s2;
  }

  return n.toFixed(0);
}

export function capitalize(string: string): string {
  return string.slice(0, 1).toUpperCase() + string.slice(1);
}

export function escapeHtml(string: string): string {
  return string.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return match;
    }
  });
}

export function silentlyReadIntEnvValue(
  value: string | undefined,
  defaultValue: number,
): number {
  return /^\d+$/.test(value ?? "") ? Number(value) : defaultValue;
}

export const toError: (arg: unknown) => NodeJS.ErrnoException = (arg) =>
  arg instanceof Error
    ? arg
    : new Error(
        `Caught error not instanceof Error: ${unknownErrorToString(arg)}`,
      );

export function unknownErrorToString(error: unknown): string {
  return typeof (error as { stack?: string } | undefined)?.stack === "string"
    ? (error as { stack: string }).stack
    : typeof (error as { message?: string } | undefined)?.message === "string"
      ? (error as { message: string }).message
      : Codec.repr(error);
}
