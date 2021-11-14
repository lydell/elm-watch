import type { Readable, Writable } from "stream";
import { DecoderError, repr } from "tiny-decoders";

import { NonEmptyArray } from "./NonEmptyArray";

export type Env = Record<string, string | undefined>;

export type ReadStream = Readable & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = Writable & {
  isTTY: boolean;
  columns?: number;
};

/**
 * More type safe version of `Array#join`.
 */
export function join(array: Array<string>, separator: string): string {
  return array.join(separator);
}

export function split(string: string, splitter: string): NonEmptyArray<string> {
  return string.split(splitter) as NonEmptyArray<string>;
}

export function getSetSingleton<T>(set: Set<T>): T | undefined {
  return set.size === 1 ? Array.from(set)[0] : undefined;
}

export const CLEAR = "\x1B[2J\x1B[3J\x1B[H";
export const RESET_COLOR = "\x1B[0m";

export function bold(string: string): string {
  return `${RESET_COLOR}\x1B[1m${string}${RESET_COLOR}`;
}

export function dim(string: string): string {
  return `${RESET_COLOR}\x1B[2m${string}${RESET_COLOR}`;
}

export function removeColor(string: string): string {
  return string.replace(/\x1B\[\d+m/g, "");
}

export function cursorHorizontalAbsolute(n: number): string {
  return `\x1B[${n}G`;
}

function pad(number: number): string {
  return number.toString().padStart(2, "0");
}

export function formatDate(date: Date): string {
  return join(
    [pad(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate())],
    "-"
  );
}

export function formatTime(date: Date): string {
  return join(
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())],
    ":"
  );
}

export function capitalize(string: string): string {
  return string.slice(0, 1).toUpperCase() + string.slice(1);
}

export function silentlyReadIntEnvValue(
  value: string | undefined,
  defaultValue: number
): number {
  return /^\d+$/.test(value ?? "") ? Number(value) : defaultValue;
}

export function toError(arg: unknown): NodeJS.ErrnoException {
  return arg instanceof Error
    ? arg
    : new Error(
        `Caught error not instanceof Error: ${unknownErrorToString(arg)}`
      );
}

export type JsonError = DecoderError | SyntaxError;

export function toJsonError(arg: unknown): JsonError {
  return arg instanceof DecoderError || arg instanceof SyntaxError
    ? arg
    : new SyntaxError(
        `Caught error not instanceof DecoderError or SyntaxError: ${unknownErrorToString(
          arg
        )}`
      );
}

export function unknownErrorToString(error: unknown): string {
  return typeof (error as { stack?: string } | undefined)?.stack === "string"
    ? (error as { stack: string }).stack
    : repr(error);
}
