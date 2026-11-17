import { describe, expect, test } from "vitest";

import { isThemeResponseDone, parseTheme } from "../src/Theme.ts";

describe("isThemeResponseDone", () => {
  test("waits for the end of the background response", () => {
    expect(isThemeResponseDone("\x1B]10;rgb:ffff/ffff/ffff\x07")).toBe(false);
    expect(isThemeResponseDone("\x1B]11;")).toBe(false);
    expect(isThemeResponseDone("\x1B]11;rgb:ffff/ffff/ffff")).toBe(false);
    expect(isThemeResponseDone("\x1B]11;rgb:ffff/ffff/ffff\x1B")).toBe(false);
    expect(isThemeResponseDone("\x1B]11;rgb:ffff/ffff/ffff\x07")).toBe(true);
    expect(isThemeResponseDone("\x1B]11;rgb:ffff/ffff/ffff\x1B\\")).toBe(true);
  });

  test("accepts unexpected content", () => {
    expect(isThemeResponseDone("\x1B]11;something\x07")).toBe(true);
  });
});

describe("parseTheme", () => {
  test("1–4 hexadecimal digits per component, rounded", () => {
    const theme = parseTheme(
      [
        "\x1B]4;0;rgb:f/8/0\x07",
        "\x1B]4;1;rgb:ff/80/00\x07",
        "\x1B]4;2;rgb:fff/800/000\x07",
        "\x1B]4;3;rgb:ffff/8000/0000\x1B\\",
        "\x1B]10;rgb:12/34/56\x07",
        "\x1B]11;rgb:aaaa/bbbb/cccc\x1B\\",
      ].join(""),
    );
    expect([
      theme?.palette.black,
      theme?.palette.red,
      theme?.palette.green,
      theme?.palette.yellow,
      theme?.foreground,
      theme?.background,
    ]).toStrictEqual([
      "#ff8800",
      "#ff8000",
      "#ff8000",
      "#ff8000",
      "#123456",
      "#aabbcc",
    ]);
  });

  test("foreground and background are required", () => {
    const foreground = "\x1B]10;rgb:1111/2222/3333\x07";
    const background = "\x1B]11;rgb:aaaa/bbbb/cccc\x07";
    expect(parseTheme(foreground + background)).toMatchObject({
      foreground: "#112233",
      background: "#aabbcc",
    });
    // Missing foreground.
    expect(parseTheme(background)).toBeUndefined();
    // Unparseable background (`isThemeResponseDone` accepts any response).
    expect(parseTheme(`${foreground}\x1B]11;?\x07`)).toBeUndefined();
  });

  test("foreground and background must not be (almost) the same", () => {
    const parse = (foreground: string, background: string): unknown =>
      parseTheme(`\x1B]10;rgb:${foreground}\x07\x1B]11;rgb:${background}\x07`);
    // Reported by elm-watch running in tmux via overmind.
    expect(parse("0000/0000/0000", "0000/0000/0000")).toBeUndefined();
    expect(parse("ffff/ffff/ffff", "f0f0/f0f0/f0f0")).toBeUndefined();
    // A low contrast theme (Solarized Dark) is fine.
    expect(parse("8383/9494/9696", "0000/2b2b/3636")).toMatchObject({
      foreground: "#839496",
      background: "#002b36",
    });
  });
});
