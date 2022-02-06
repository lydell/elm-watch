import {
  formatDate,
  formatTime,
  printDurationMs,
  printFileSize,
  unknownErrorToString,
} from "../src/Helpers";
import { stringSnapshotSerializer } from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("Helpers", () => {
  describe("formatDate", () => {
    test("pad", () => {
      expect(formatDate(new Date("2021-01-01"))).toBe("2021-01-01");
    });

    test("no pad", () => {
      expect(formatDate(new Date("2021-10-20"))).toBe("2021-10-20");
    });
  });

  describe("formatTime", () => {
    test("new years eve", () => {
      expect(formatTime(new Date("2021-12-31T23:59:58Z"))).toBe("23:59:58");
    });

    test("new years day", () => {
      expect(formatTime(new Date("2022-01-01T00:00:00Z"))).toBe("00:00:00");
    });

    test("padding and non-padding", () => {
      expect(formatTime(new Date("2022-01-01T01:09:10Z"))).toBe("01:09:10");
    });
  });

  test("printFileSize", () => {
    const output = Array.from({ length: 32 }, (_, i) => {
      const t1 = 2 ** i;
      const t2 = Math.round(t1 + 1.9 ** (i - 1));
      return [t1, t2];
    })
      .flat()
      .map((fileSize) => `|${printFileSize(fileSize)}| <- ${fileSize}`)
      .join("\n");
    expect(output).toMatchInlineSnapshot(`
      |0.00 KiB| <- 1
      |0.00 KiB| <- 2
      |0.00 KiB| <- 2
      |0.00 KiB| <- 3
      |0.00 KiB| <- 4
      |0.01 KiB| <- 6
      |0.01 KiB| <- 8
      |0.01 KiB| <- 12
      |0.02 KiB| <- 16
      |0.02 KiB| <- 23
      |0.03 KiB| <- 32
      |0.04 KiB| <- 45
      |0.06 KiB| <- 64
      |0.09 KiB| <- 89
      |0.13 KiB| <- 128
      |0.17 KiB| <- 175
      |0.25 KiB| <- 256
      |0.34 KiB| <- 345
      |0.50 KiB| <- 512
      |0.67 KiB| <- 682
      |1.00 KiB| <- 1024
      |1.32 KiB| <- 1347
      |2.00 KiB| <- 2048
      |2.60 KiB| <- 2661
      |4.00 KiB| <- 4096
      |5.14 KiB| <- 5261
      |8.00 KiB| <- 8192
      |10.2 KiB| <- 10405
      |16.0 KiB| <- 16384
      |20.1 KiB| <- 20589
      |32.0 KiB| <- 32768
      |39.8 KiB| <- 40758
      |64.0 KiB| <- 65536
      |78.8 KiB| <- 80717
      | 128 KiB| <- 131072
      | 156 KiB| <- 159916
      | 256 KiB| <- 262144
      | 310 KiB| <- 316948
      | 512 KiB| <- 524288
      | 614 KiB| <- 628415
      |1.00 MiB| <- 1048576
      |1.19 MiB| <- 1246418
      |2.00 MiB| <- 2097152
      |2.36 MiB| <- 2473052
      |4.00 MiB| <- 4194304
      |4.68 MiB| <- 4908513
      |8.00 MiB| <- 8388608
      |9.29 MiB| <- 9745606
      |16.0 MiB| <- 16777216
      |18.5 MiB| <- 19355512
      |32.0 MiB| <- 33554432
      |36.7 MiB| <- 38453195
      |64.0 MiB| <- 67108864
      |72.9 MiB| <- 76416514
      | 128 MiB| <- 134217728
      | 145 MiB| <- 151902262
      | 256 MiB| <- 268435456
      | 288 MiB| <- 302036071
      | 512 MiB| <- 536870912
      | 573 MiB| <- 600712080
      |1024 MiB| <- 1073741824
      |1140 MiB| <- 1195040044
      |2048 MiB| <- 2147483648
      |2268 MiB| <- 2377950266
    `);
  });

  test("printDurationMs", () => {
    const output = Array.from({ length: 8 }, (_, i) => {
      const t1 = 10 ** i;
      const t2 = Math.round(t1 * Math.PI);
      return [t1, t2];
    })
      .flat()
      .map((duration) => `|${printDurationMs(duration)}| <- ${duration}`)
      .join("\n");
    expect(output).toMatchInlineSnapshot(`
      |  1 ms| <- 1
      |  3 ms| <- 3
      | 10 ms| <- 10
      | 31 ms| <- 31
      |100 ms| <- 100
      |314 ms| <- 314
      |1.00 s| <- 1000
      |3.14 s| <- 3142
      |10.0 s| <- 10000
      |31.4 s| <- 31416
      | 100 s| <- 100000
      | 314 s| <- 314159
      |1000 s| <- 1000000
      |3142 s| <- 3141593
      |10000 s| <- 10000000
      |31416 s| <- 31415927
    `);
  });

  describe("unknownErrorToString", () => {
    test("Error with stack", () => {
      const error = new Error("Some error message");
      error.stack = `${error.message}\n    at function`;
      expect(unknownErrorToString(error)).toBe(error.stack);
    });

    test("Error without stack", () => {
      const error = new Error("Some error message");
      delete error.stack;
      expect(unknownErrorToString(error)).toBe(error.message);
    });

    test("Fake error without stack and message", () => {
      class FakeError {}
      expect(unknownErrorToString(new FakeError())).toBe("FakeError {}");
    });

    test("just a string", () => {
      expect(unknownErrorToString("some error string")).toBe(
        '"some error string"'
      );
    });

    test("undefined", () => {
      expect(unknownErrorToString(undefined)).toBe("undefined");
    });

    test("null", () => {
      expect(unknownErrorToString(null)).toBe("null");
    });
  });
});
