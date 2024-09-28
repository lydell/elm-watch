import * as Decode from "tiny-decoders";

export type NonEmptyArray<T> = [T, ...Array<T>];

export function NonEmptyArray<T>(
  decoder: Decode.Decoder<T>,
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
  f: (item: T, index: number) => U,
): NonEmptyArray<U> {
  return array.map(f) as NonEmptyArray<U>;
}

export function flattenNonEmptyArray<T>(
  array: NonEmptyArray<NonEmptyArray<T>>,
): NonEmptyArray<T> {
  return array.flat() as NonEmptyArray<T>;
}

export function nonEmptyArrayUniqueBy<T>(
  f: (item: T) => string,
  items: NonEmptyArray<T>,
): NonEmptyArray<T> {
  const result: NonEmptyArray<T> = [items[0]];
  for (const item of items) {
    if (result.every((otherItem) => f(otherItem) !== f(item))) {
      result.push(item);
    }
  }
  return result;
}
