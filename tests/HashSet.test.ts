import { describe, expect, test } from "vitest";

import { HashSet } from "../src/HashSet";

type Id = { id: number };

describe("HashSet", () => {
  describe("constructor and size", () => {
    test("no arg", () => {
      const set = new HashSet();
      expect(set.size).toBe(0);
      expect(Array.from(set)).toEqual([]);
    });

    test("null", () => {
      const set = new HashSet(null);
      expect(set.size).toBe(0);
      expect(Array.from(set)).toEqual([]);
    });

    test("iterable", () => {
      const set = new HashSet<Id>([{ id: 1 }, { id: 2 }, { id: 1 }]);
      expect(set.size).toBe(2);
      expect(Array.from(set)).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  test("has, add, delete, clear", () => {
    const set = new HashSet<Id>();

    expect(set.has({ id: 1 })).toBe(false);

    set.add({ id: 1 });
    expect(set.has({ id: 1 })).toBe(true);

    set.add({ id: 2 });
    expect(set.has({ id: 2 })).toBe(true);

    expect(set.has({ id: 3 })).toBe(false);

    set.delete({ id: 2 });
    expect(set.has({ id: 2 })).toBe(false);
    expect(set.has({ id: 1 })).toBe(true);

    set.clear();
    expect(set.has({ id: 1 })).toBe(false);
  });

  test("keys", () => {
    const set = new HashSet<Id>([{ id: 1 }, { id: 2 }, { id: 1 }]);
    expect(Array.from(set.keys())).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("values", () => {
    const set = new HashSet<Id>([{ id: 1 }, { id: 2 }, { id: 1 }]);
    expect(Array.from(set.values())).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("entries", () => {
    const set = new HashSet<Id>([{ id: 1 }, { id: 2 }, { id: 1 }]);
    expect(Array.from(set.entries())).toEqual([
      [{ id: 1 }, { id: 1 }],
      [{ id: 2 }, { id: 2 }],
    ]);
  });

  test("iterator", () => {
    const set = new HashSet<Id>([{ id: 1 }, { id: 2 }, { id: 1 }]);
    const items: Array<Id> = [];
    for (const item of set) {
      items.push(item);
    }
    expect(items).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("toString", () => {
    const set = new HashSet();
    expect(String(set)).toBe("[object HashSet]");
  });
});
