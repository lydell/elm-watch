import * as os from "os";
import type { Readable, Writable } from "stream";

export type Env = Record<string, string | undefined>;

export type ReadStream = Readable & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = Writable & {
  isTTY: boolean;
  columns: number;
};

export const IS_WINDOWS = os.platform() === "win32";

/**
 * More type safe version of `Array#join`.
 */
export function join(array: Array<string>, separator: string): string {
  return array.join(separator);
}

export function getSetSingleton<T>(set: Set<T>): T | undefined {
  return set.size === 1 ? Array.from(set)[0] : undefined;
}

export const RESET_COLOR = "\x1B[0m";

export function bold(string: string): string {
  return `${RESET_COLOR}\x1B[1m${string}${RESET_COLOR}`;
}

export function dim(string: string): string {
  return `${RESET_COLOR}\x1B[2m${string}${RESET_COLOR}`;
}

export function removeColor(string: string): string {
  return string.replace(/\x1B\[\dm/g, "");
}
