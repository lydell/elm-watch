import * as Codec from "tiny-decoders";
import * as util from "util";

/**
 * Like a `Set`, but the items are looked up by structure instead of by
 * reference.
 *
 * NOTE: The items must be `JSON.stringify`-able.
 */
export class HashSet<V extends Record<string, unknown>> implements Set<V> {
  private _set = new Set<string>();

  constructor(values?: ReadonlyArray<V> | null) {
    if (values !== undefined && values !== null) {
      for (const value of values) {
        this._set.add(hash(value));
      }
    }
  }

  get size(): number {
    return this._set.size;
  }

  has(value: V): boolean {
    return this._set.has(hash(value));
  }

  add(value: V): this {
    this._set.add(hash(value));
    return this;
  }

  delete(value: V): boolean {
    return this._set.delete(hash(value));
  }

  clear(): void {
    this._set.clear();
  }

  /**
   * forEach is not implemented. Use a for-of loop instead.
   */
  // istanbul ignore next
  forEach(callback: never): never {
    return callback;
  }

  *keys(): IterableIterator<V> {
    for (const value of this._set.keys()) {
      yield Codec.JSON.parse(Codec.unknown, value) as unknown as V;
    }
  }

  values(): IterableIterator<V> {
    return this.keys();
  }

  *entries(): IterableIterator<[V, V]> {
    for (const value of this.keys()) {
      yield [value, value];
    }
  }

  [Symbol.iterator](): IterableIterator<V> {
    return this.keys();
  }

  [Symbol.toStringTag] = "HashSet";

  // istanbul ignore next
  [util.inspect.custom](): Set<V> {
    return new Set(this);
  }
}

function hash(value: Record<string, unknown>): string {
  return Codec.JSON.stringify(
    Codec.unknown,
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    )
  );
}
