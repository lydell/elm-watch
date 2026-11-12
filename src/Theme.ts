import type { Color } from "./ElmMakeError.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import type { Terminal } from "./Terminal.ts";

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
  (_, i) => `\x1B]4;${i};?\x1B\\`, // Palette.
)
  .concat("\x1B]10;?\x1B\\", "\x1B]11;?\x1B\\") // Foreground and background.
  .join("");

// The background is queried last, so we’re done when its response has ended.
// On macOS (both the default Terminal and iTerm), the returned escape ends with
// `\x07`. On Gnome Terminal it ends with `\x1B\\`. The response can arrive in
// several chunks, so `]11;` alone is not enough. Any content is accepted, so
// that an unexpected response doesn’t make us wait for the timeout (and lose
// the palette colors).
const THEME_ESCAPES_DONE_REGEX = /\x1B\]11;[^\x07\x1B]*(?:\x07|\x1B\\)/;

// No need to match the “end” here – just take the hexadecimal parts we want.
// Each part can have 1–4 hexadecimal digits.
const THEME_ESCAPES_REGEX =
  /\x1B](4;)?(\d+);rgb:([\da-f]{1,4})\/([\da-f]{1,4})\/([\da-f]{1,4})/gi;

// The 16 basic colors, in terminal order (`30`–`37` and `90`–`97`).
export const PALETTE: Array<Color> = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "BLACK",
  "RED",
  "GREEN",
  "YELLOW",
  "BLUE",
  "MAGENTA",
  "CYAN",
  "WHITE",
];

//https://github.com/chalk/ansi-styles/blob/cd0b0cb59337bfd7d3669b2d0fcde7ff661a83a6/index.js#L25-L42
export const COLOR_TO_TERMINAL_ESCAPE: Record<Color, string> = {
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

export const DEFAULT_THEME: Theme = {
  // Picked using eye dropper on VSCode’s default dark theme, in its terminal.
  foreground: "rgb(204, 204, 204)",
  background: "rgb(32, 30, 30)",
  // Taken from the “Visual Studio Code” column at:
  // https://en.wikipedia.org/wiki/ANSI_escape_code#Colors
  palette: {
    red: "rgb(205, 49, 49)",
    RED: "rgb(241, 76, 76)",
    magenta: "rgb(188, 63, 188)",
    MAGENTA: "rgb(214, 112, 214)",
    yellow: "rgb(229, 229, 16)",
    YELLOW: "rgb(245, 245, 67)",
    green: "rgb(13, 188, 121)",
    GREEN: "rgb(35, 209, 139)",
    cyan: "rgb(17, 168, 205)",
    CYAN: "rgb(41, 184, 219)",
    blue: "rgb(36, 114, 200)",
    BLUE: "rgb(59, 142, 234)",
    black: "rgb(0, 0, 0)",
    BLACK: "rgb(102, 102, 102)",
    white: "rgb(229, 229, 229)",
    WHITE: "rgb(229, 229, 229)",
  },
};

export async function getThemeFromTerminal(terminal: Terminal): Promise<Theme> {
  // Querying colors is not supported on Windows:
  // https://github.com/microsoft/terminal/issues/3718
  // Save them the timeout.
  if (IS_WINDOWS) {
    return DEFAULT_THEME;
  }
  const stdin = await terminal.query(THEME_ESCAPES_STRING, isThemeResponseDone);
  return stdin === undefined ? DEFAULT_THEME : parseTheme(stdin);
}

export function isThemeResponseDone(stdin: string): boolean {
  return THEME_ESCAPES_DONE_REGEX.test(stdin);
}

export function parseTheme(stdin: string): Theme {
  const theme = { ...DEFAULT_THEME, palette: { ...DEFAULT_THEME.palette } };

  for (const match of stdin.matchAll(THEME_ESCAPES_REGEX)) {
    const [, isPaletteString, indexString, r = "0", g = "0", b = "0"] = match;
    const isPalette = isPaletteString !== undefined;
    const index = Number(indexString);
    const color = `#${convert(r)}${convert(g)}${convert(b)}`;

    if (isPalette) {
      const colorName = PALETTE[index];
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
function convert(hexDigits: string): string {
  const max = 16 ** hexDigits.length - 1;
  return Math.round((parseInt(hexDigits, 16) / max) * 0xff)
    .toString(16)
    .padStart(2, "0");
}
