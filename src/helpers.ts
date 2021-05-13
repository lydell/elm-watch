import * as fs from "fs";
import * as path from "path";
import type { Readable, Writable } from "stream";
import * as Decode from "tiny-decoders";

export type Env = Record<string, string | undefined>;

export type ReadStream = Readable & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = Writable & {
  isTTY: boolean;
};

export type NonEmptyArray<T> = [T, ...Array<T>];

export function NonEmptyArray<T>(
  decoder: Decode.Decoder<T>
): Decode.Decoder<NonEmptyArray<T>> {
  return Decode.chain(Decode.array(decoder), (array) => {
    if (isNonEmptyArray(array)) {
      return array;
    }
    throw new Decode.DecoderError({
      message: "Expected a non-empty array",
      value: array,
    });
  });
}

export function isNonEmptyArray<T>(array: Array<T>): array is NonEmptyArray<T> {
  return array.length >= 1;
}

export function mapNonEmptyArray<T, U>(
  array: NonEmptyArray<T>,
  f: (item: T, index: number) => U
): NonEmptyArray<U> {
  return array.map(f) as NonEmptyArray<U>;
}

export function findClosest(name: string, dir: string): string | undefined {
  const entry = path.join(dir, name);
  return fs.existsSync(entry)
    ? entry
    : dir === path.parse(dir).root
    ? undefined
    : findClosest(name, path.dirname(dir));
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
