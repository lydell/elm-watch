import { escapeHtml } from "./Helpers.ts";
import { PALETTE, type Theme } from "./Theme.ts";

// Turns text with colors (ANSI escape codes) into HTML, for showing errors
// from other tools (see ExternalErrors.ts) in the browser. The text must have
// been sanitized with `sanitizeTerminalText` first, so that the only escape
// codes left are SGR (colors and styles). The 16 basic colors come from the
// terminal’s theme, so that the browser looks like the terminal.

type Style = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  foreground: string | undefined;
  background: string | undefined;
};

const DEFAULT_STYLE: Style = {
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  foreground: undefined,
  background: undefined,
};

const SGR = /\x1B\[([\d;:]*)m/g;

export function ansiToHtml(text: string, theme: Theme): string {
  let html = "";
  let style = DEFAULT_STYLE;
  let index = 0;
  for (const match of text.matchAll(SGR)) {
    html += renderText(text.slice(index, match.index), style, theme);
    style = applySgr(style, match[1] ?? "", theme);
    index = match.index + match[0].length;
  }
  return html + renderText(text.slice(index), style, theme);
}

function renderText(text: string, style: Style, theme: Theme): string {
  if (text === "") {
    return "";
  }
  const [foreground, background] = style.inverse
    ? [
        style.background ?? theme.background,
        style.foreground ?? theme.foreground,
      ]
    : [style.foreground, style.background];
  const decoration = [
    style.underline ? "underline" : undefined,
    style.strikethrough ? "line-through" : undefined,
  ]
    .flatMap((part) => part ?? [])
    .join(" ");
  const css = [
    style.bold ? "font-weight: bold" : undefined,
    style.dim ? "opacity: 0.6" : undefined,
    style.italic ? "font-style: italic" : undefined,
    decoration === "" ? undefined : `text-decoration: ${decoration}`,
    foreground === undefined ? undefined : `color: ${foreground}`,
    background === undefined ? undefined : `background-color: ${background}`,
  ].flatMap((part) => part ?? []);
  return css.length === 0
    ? escapeHtml(text)
    : `<span style="${css.join("; ")}">${escapeHtml(text)}</span>`;
}

// Parameters are usually separated by `;`, but `38:5:n` and `38:2::r:g:b`
// (with `:`) are also in use, as well as the kitty extensions `4:n` (underline
// style) and `58` (underline color). Unknown parameters are ignored.
function applySgr(style: Style, parameters: string, theme: Theme): Style {
  // An empty parameter (`\x1B[m`) means 0 (reset), since `Number("")` is 0.
  const groups = parameters.split(";");
  let newStyle = style;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i] ?? "";
    if (group.includes(":")) {
      // For example `38:2::255:0:0` (the empty part is the color space ID).
      const [code, ...rest] = group.split(":").map(Number);
      newStyle =
        code === 4
          ? applyUnderlineStyle(newStyle, rest[0])
          : applyExtendedColor(newStyle, code, rest, theme);
      continue;
    }
    const code = Number(group);
    if (code === 38 || code === 48 || code === 58) {
      // For example `38;5;n` or `38;2;r;g;b`. Underline colors (58) are not
      // supported, but their arguments must still be skipped.
      const kind = Number(groups[i + 1]);
      const length = kind === 5 ? 2 : kind === 2 ? 4 : 1;
      newStyle = applyExtendedColor(
        newStyle,
        code,
        groups.slice(i + 1, i + 1 + length).map(Number),
        theme,
      );
      i += length;
      continue;
    }
    newStyle = applyCode(newStyle, code, theme);
  }
  return newStyle;
}

// `4:0` is no underline, `4:1` to `4:5` are straight, double, curly, dotted
// and dashed – all shown as a regular underline.
function applyUnderlineStyle(style: Style, kind: number | undefined): Style {
  return kind !== undefined && kind <= 5
    ? { ...style, underline: kind !== 0 }
    : style;
}

function applyCode(style: Style, code: number, theme: Theme): Style {
  if (code >= 30 && code <= 37) {
    return { ...style, foreground: paletteColor(code - 30, theme) };
  }
  if (code >= 90 && code <= 97) {
    return { ...style, foreground: paletteColor(code - 90 + 8, theme) };
  }
  if (code >= 40 && code <= 47) {
    return { ...style, background: paletteColor(code - 40, theme) };
  }
  if (code >= 100 && code <= 107) {
    return { ...style, background: paletteColor(code - 100 + 8, theme) };
  }
  switch (code) {
    case 0:
      return DEFAULT_STYLE;
    case 1:
      return { ...style, bold: true };
    case 2:
      return { ...style, dim: true };
    case 3:
      return { ...style, italic: true };
    case 4:
      return { ...style, underline: true };
    case 7:
      return { ...style, inverse: true };
    case 9:
      return { ...style, strikethrough: true };
    case 22:
      return { ...style, bold: false, dim: false };
    case 23:
      return { ...style, italic: false };
    case 24:
      return { ...style, underline: false };
    case 27:
      return { ...style, inverse: false };
    case 29:
      return { ...style, strikethrough: false };
    case 39:
      return { ...style, foreground: undefined };
    case 49:
      return { ...style, background: undefined };
    default:
      return style;
  }
}

function applyExtendedColor(
  style: Style,
  code: number | undefined,
  rest: Array<number>,
  theme: Theme,
): Style {
  const key =
    code === 38 ? "foreground" : code === 48 ? "background" : undefined;
  if (key === undefined) {
    return style;
  }
  const [kind, ...numbers] = rest;
  let color: string | undefined = undefined;
  if (kind === 5) {
    color = color256(numbers[0] ?? -1, theme);
  } else if (kind === 2) {
    // Colon form: `38:2:<color space>:r:g:b`, or without the color space.
    const rgb = numbers.length >= 4 ? numbers.slice(1, 4) : numbers;
    color =
      rgb.length === 3 && rgb.every(isByte)
        ? `rgb(${rgb.join(", ")})`
        : undefined;
  }
  return color === undefined ? style : { ...style, [key]: color };
}

function isByte(value: number | undefined): boolean {
  return (
    value !== undefined && Number.isInteger(value) && value >= 0 && value <= 255
  );
}

function paletteColor(index: number, theme: Theme): string | undefined {
  const color = PALETTE[index];
  return color === undefined ? undefined : theme.palette[color];
}

// https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit
function color256(n: number, theme: Theme): string | undefined {
  if (!isByte(n)) {
    return undefined;
  }
  if (n < 16) {
    return paletteColor(n, theme);
  }
  if (n < 232) {
    const levels = [0, 95, 135, 175, 215, 255];
    const i = n - 16;
    const r = levels[Math.floor(i / 36)] ?? 0;
    const g = levels[Math.floor(i / 6) % 6] ?? 0;
    const b = levels[i % 6] ?? 0;
    return `rgb(${r}, ${g}, ${b})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray}, ${gray}, ${gray})`;
}
