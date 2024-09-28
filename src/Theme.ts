import { Color } from "./ElmMakeError";
import { IS_WINDOWS } from "./IsWindows";
import { Logger } from "./Logger";

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

const THEME_ESCAPES_DONE_CHECK = "]11;";

// On macOS (both the default Terminal and iTerm), the returned escape ends with `\x07`.
// On Gnome Terminal it ends with `\x1B\\`. I don’t think there’s any need of matching
// the “end” – just take the hexadecimal parts we want.
const THEME_ESCAPES_REGEX =
  /\x1B](4;)?(\d+);rgb:([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})/gi;

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

const DEFAULT_THEME: Theme = {
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

export async function getThemeFromTerminal(logger: Logger): Promise<Theme> {
  // Querying colors is not supported on Windows:
  // https://github.com/microsoft/terminal/issues/3718
  // Save them the timeout.
  /* v8 ignore start */
  if (IS_WINDOWS) {
    return DEFAULT_THEME;
  }
  /* v8 ignore stop */
  const stdin = await logger.queryTerminal(THEME_ESCAPES_STRING, (stdinSoFar) =>
    stdinSoFar.includes(THEME_ESCAPES_DONE_CHECK),
  );
  return stdin === undefined ? DEFAULT_THEME : parseTheme(stdin);
}

function parseTheme(stdin: string): Theme {
  const theme = { ...DEFAULT_THEME, palette: { ...DEFAULT_THEME.palette } };

  for (const match of stdin.matchAll(THEME_ESCAPES_REGEX)) {
    /* v8 ignore next */
    const [, isPaletteString, indexString, r = "0", g = "0", b = "0"] = match;
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
function convert(hexDigits: string): string {
  return Math.floor((parseInt(hexDigits, 16) / 0xffff) * 0xff)
    .toString(16)
    .padStart(2, "0");
}
