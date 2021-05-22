import { HashMap } from "../src/HashMap";

type Id = { id: number };

describe("HashMap", () => {
  describe("constructor and size", () => {
    test("no arg", () => {
      const map = new HashMap();
      expect(map.size).toBe(0);
      expect(Array.from(map)).toEqual([]);
    });

    test("null", () => {
      const map = new HashMap(null);
      expect(map.size).toBe(0);
      expect(Array.from(map)).toEqual([]);
    });

    test("iterable", () => {
      const map = new HashMap<Id, number>([
        [{ id: 1 }, 1],
        [{ id: 2 }, 2],
        [{ id: 1 }, 3],
      ]);
      expect(map.size).toBe(2);
      expect(Array.from(map)).toEqual([
        [{ id: 1 }, 3],
        [{ id: 2 }, 2],
      ]);
    });
  });

  test("has, get, add, delete, clear", () => {
    const map = new HashMap<Id, number>();

    expect(map.has({ id: 1 })).toBe(false);

    map.set({ id: 1 }, 1);
    expect(map.has({ id: 1 })).toBe(true);
    expect(map.get({ id: 1 })).toBe(1);

    map.set({ id: 2 }, 2);
    expect(map.has({ id: 2 })).toBe(true);
    expect(map.get({ id: 2 })).toBe(2);

    expect(map.has({ id: 3 })).toBe(false);
    expect(map.get({ id: 3 })).toBeUndefined();

    map.delete({ id: 2 });
    expect(map.has({ id: 2 })).toBe(false);
    expect(map.has({ id: 1 })).toBe(true);

    map.clear();
    expect(map.has({ id: 1 })).toBe(false);
  });

  test("keys", () => {
    const map = new HashMap<Id, number>([
      [{ id: 1 }, 1],
      [{ id: 2 }, 2],
      [{ id: 1 }, 3],
    ]);
    expect(Array.from(map.keys())).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("values", () => {
    const map = new HashMap<Id, number>([
      [{ id: 1 }, 1],
      [{ id: 2 }, 2],
      [{ id: 1 }, 3],
    ]);
    expect(Array.from(map.values())).toEqual([3, 2]);
  });

  test("entries", () => {
    const map = new HashMap<Id, number>([
      [{ id: 1 }, 1],
      [{ id: 2 }, 2],
      [{ id: 1 }, 3],
    ]);
    expect(Array.from(map.entries())).toEqual([
      [{ id: 1 }, 3],
      [{ id: 2 }, 2],
    ]);
  });

  test("iterator", () => {
    const map = new HashMap<Id, number>([
      [{ id: 1 }, 1],
      [{ id: 2 }, 2],
      [{ id: 1 }, 3],
    ]);
    const items: Array<[Id, number]> = [];
    for (const item of map) {
      items.push(item);
    }
    expect(items).toEqual([
      [{ id: 1 }, 3],
      [{ id: 2 }, 2],
    ]);
  });

  test("toString", () => {
    const map = new HashMap();
    expect(String(map)).toBe("[object HashMap]");
  });
});
