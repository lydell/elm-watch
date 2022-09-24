// Inspired by Elm – see ElmMakeError.ts.

import { Logger } from "./Logger";

// Lowercase means “dull” (regular) and uppercase means “vivid” (bright):
export type Color =
  | "BLACK"
  | "black"
  | "BLUE"
  | "blue"
  | "CYAN"
  | "cyan"
  | "GREEN"
  | "green"
  | "MAGENTA"
  | "magenta"
  | "RED"
  | "red"
  | "WHITE"
  | "white"
  | "YELLOW"
  | "yellow";

export type Theme = {
  foreground: string;
  background: string;
  palette: { [key in Color]: string };
};

// This gets the RGB values for the 16 ANSI colors (8 normal and 8 bright), as
// well as the foreground and background colors.
// Search for “Set Text Parameters” in: https://www.xfree86.org/current/ctlseqs.html
const THEME_ESCAPES_STRING = Array.from(
  { length: 16 },
  (_, i) => `\x1B]4;${i};?\x1B\\` // Palette.
)
  .concat("\x1B]10;?\x1B\\", "\x1B]11;?\x1B\\") // Foreground and background.
  .join("");

const THEME_ESCAPES_DONE_CHECK = "]11;";

const THEME_ESCAPES_REGEX =
  /\x1B](4;)?(\d+);rgb:([\da-f]+)\/([\da-f]+)\/([\da-f]+)\x07/gi;

const INDEX_TO_COLOR: Record<number, Color> = {
  0: "black",
  1: "red",
  2: "green",
  3: "yellow",
  4: "blue",
  5: "magenta",
  6: "cyan",
  7: "white",
  8: "BLACK",
  9: "RED",
  10: "GREEN",
  11: "YELLOW",
  12: "BLUE",
  13: "MAGENTA",
  14: "CYAN",
  15: "WHITE",
};

//https://github.com/chalk/ansi-styles/blob/cd0b0cb59337bfd7d3669b2d0fcde7ff661a83a6/index.js#L25-L42
const COLOR_TO_TERMINAL_ESCAPE: Record<Color, string> = {
  red: "\x1B[31m",
  RED: "\x1B[91m",
  magenta: "\x1B[35m",
  MAGENTA: "\x1B[95m",
  yellow: "\x1B[33m",
  YELLOW: "\x1B[93m",
  green: "\x1B[32m",
  GREEN: "\x1B[92m",
  cyan: "\x1B[36m",
  CYAN: "\x1B[96m",
  blue: "\x1B[34m",
  BLUE: "\x1B[94m",
  black: "\x1B[30m",
  BLACK: "\x1B[90m",
  white: "\x1B[37m",
  WHITE: "\x1B[97m",
};

const DEFAULT_THEME: Theme = {
  foreground: "white",
  background: "black",
  palette: {
    red: "red",
    RED: "red",
    magenta: "magenta",
    MAGENTA: "magenta",
    yellow: "yellow",
    YELLOW: "yellow",
    green: "green",
    GREEN: "green",
    cyan: "cyan",
    CYAN: "cyan",
    blue: "blue",
    BLUE: "blue",
    black: "black",
    BLACK: "black",
    white: "white",
    WHITE: "white",
  },
};

async function getThemeFromTerminal(logger: Logger): Promise<Theme> {
  const stdin = await logger.queryTerminal(THEME_ESCAPES_STRING, (stdinSoFar) =>
    stdinSoFar.includes(THEME_ESCAPES_DONE_CHECK)
  );
  return stdin === undefined ? DEFAULT_THEME : parseTheme(stdin);
}

function parseTheme(stdin: string): Theme {
  const theme = { ...DEFAULT_THEME, palette: { ...DEFAULT_THEME.palette } };

  for (const match of stdin.matchAll(THEME_ESCAPES_REGEX)) {
    const [, isPaletteString, indexString, r, g, b] = match;
    const isPalette = isPaletteString !== undefined;
    const index = Number(indexString);
    const color = `#${convert(r)}${convert(g)}${convert(b)}`;

    if (isPalette) {
      const colorName = INDEX_TO_COLOR[index];
      if (colorName !== undefined) {
        theme.palette[colorName] = color;
      }
    } else if (index === 10) {
      theme.foreground = color;
    } else if (index === 11) {
      theme.background = color;
    }
  }

  return theme;
}

// https://github.com/xtermjs/xterm.js/blob/19367a6042a6360e9130fd0fbee0a66cdd75ddd4/src/common/input/XParseColor.ts#L7-L56
function convert(hexDigits: string = "0"): string {
  return Math.floor((parseInt(hexDigits, 16) / 0xffff) * 0xff)
    .toString(16)
    .padStart(2, "0");
}
