import { formatDate, formatTime, unknownErrorToString } from "../src/Helpers";

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
      expect(formatTime(new Date("2021-12-31T23:59:58"))).toBe("23:59:58");
    });

    test("new years day", () => {
      expect(formatTime(new Date("2022-01-01T00:00:00"))).toBe("00:00:00");
    });

    test("padding and non-padding", () => {
      expect(formatTime(new Date("2022-01-01T01:09:10"))).toBe("01:09:10");
    });
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
