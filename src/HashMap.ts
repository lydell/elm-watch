import * as util from "util";

import * as Codec from "./Codec";

/**
 * Like a `Map`, but the keys are looked up by structure instead of by
 * reference.
 *
 * NOTE: The keys must be `JSON.stringify`-able.
 */
export class HashMap<K extends Record<string, unknown>, V>
  implements Map<K, V>
{
  private map = new Map<string, V>();

  constructor(entries?: ReadonlyArray<readonly [K, V]> | null) {
    if (entries !== undefined && entries !== null) {
      for (const [key, value] of entries) {
        this.map.set(hash(key), value);
      }
    }
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(hash(key));
  }

  get(key: K): V | undefined {
    return this.map.get(hash(key));
  }

  set(key: K, value: V): this {
    this.map.set(hash(key), value);
    return this;
  }

  delete(key: K): boolean {
    return this.map.delete(hash(key));
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * forEach is not implemented. Use a for-of loop instead.
   */
  // istanbul ignore next
  forEach(callback: never): never {
    return callback;
  }

  *keys(): IterableIterator<K> {
    for (const key of this.map.keys()) {
      yield Codec.parseWithoutCodec(key) as K;
    }
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  *entries(): IterableIterator<[K, V]> {
    for (const [key, value] of this.map.entries()) {
      yield [Codec.parseWithoutCodec(key) as K, value];
    }
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  [Symbol.toStringTag] = "HashMap";

  // istanbul ignore next
  [util.inspect.custom](): Map<K, V> {
    return new Map(this);
  }
}

function hash(value: Record<string, unknown>): string {
  return Codec.stringifyWithoutCodec(
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    )
  );
}
