import * as Codec from "tiny-decoders";

// Editors that can be opened via a URL, such as `vscode://file/path:1:2`.
// This module is used both by the server and by the browser UI.
//
// The chosen editor is stored as a string in elm-stuff/elm-watch/stuff.json,
// and sent as a string over the WebSocket: Either the ID of a preset, or a
// custom URL template.

export type EditorPreset = {
  id: string;
  name: string;
  template: string;
};

// The most common editors for Elm. Other editors can be used via a custom
// URL template.
export const EDITOR_PRESETS: Array<EditorPreset> = [
  {
    id: "vscode",
    name: "VS Code",
    template: "vscode://file{file}:{line}:{column}",
  },
  {
    id: "cursor",
    name: "Cursor",
    template: "cursor://file{file}:{line}:{column}",
  },
  {
    id: "zed",
    name: "Zed",
    template: "zed://file{file}:{line}:{column}",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    template: "idea://open?file={file}&line={line}&column={column0}",
  },
  {
    id: "webstorm",
    name: "WebStorm",
    template: "webstorm://open?file={file}&line={line}&column={column0}",
  },
  {
    id: "rider",
    name: "Rider",
    template: "rider://open?file={file}&line={line}&column={column0}",
  },
];

export type Editor =
  | { tag: "Preset"; preset: EditorPreset }
  | { tag: "Custom"; template: string };

export type EditorLocation = {
  file: string;
  line: number;
  column: number;
};

// Shown in the browser UI and the terminal when choosing “Other” editor.
export const EDITOR_URL_EXAMPLE =
  "pycharm://open?file={file}&line={line}&column={column0}";

export const EDITOR_PLACEHOLDERS = [
  "{file}",
  "{line}",
  "{column}",
  "{line0}",
  "{column0}",
] as const;

// Schemes for web pages and local files, rather than for apps. The URL is
// opened by the browser (or by the OS from the terminal), and anyone who can
// connect to elm-watch’s WebSocket can set it.
const DISALLOWED_SCHEMES = new Set([
  "about",
  "blob",
  "data",
  "file",
  "ftp",
  "http",
  "https",
  "javascript",
  "vbscript",
  "ws",
  "wss",
]);

const SCHEME_REGEX = /^([a-z][a-z\d+.-]*):/i;

// Returns an error message, or `undefined` if the template is valid.
export function validateEditorUrlTemplate(
  template: string,
): string | undefined {
  const match = SCHEME_REGEX.exec(template);
  if (match === null) {
    return "The URL must start with a scheme, like myeditor://";
  }
  const scheme = (match[1] ?? "").toLowerCase();
  if (DISALLOWED_SCHEMES.has(scheme)) {
    return `${scheme}: URLs are not supported. Only URLs for opening apps, like myeditor://`;
  }
  if (/\s/.test(template)) {
    return "The URL must not contain whitespace.";
  }
  if (!template.includes("{file}")) {
    return "The URL must contain {file}.";
  }
  return undefined;
}

export function parseEditor(string: string): Editor | undefined {
  const preset = EDITOR_PRESETS.find((candidate) => candidate.id === string);
  if (preset !== undefined) {
    return { tag: "Preset", preset };
  }
  return validateEditorUrlTemplate(string) === undefined
    ? { tag: "Custom", template: string }
    : undefined;
}

export function editorToString(editor: Editor): string {
  switch (editor.tag) {
    case "Preset":
      return editor.preset.id;
    case "Custom":
      return editor.template;
  }
}

export function editorTemplate(editor: Editor): string {
  switch (editor.tag) {
    case "Preset":
      return editor.preset.template;
    case "Custom":
      return editor.template;
  }
}

// A string that is either a preset ID or a valid URL template.
export const EditorString = Codec.flatMap(Codec.string, {
  decoder: (value) =>
    parseEditor(value) === undefined
      ? {
          tag: "DecoderError",
          error: {
            tag: "custom",
            path: [],
            message: "Expected an editor preset ID or a valid URL template",
            got: value,
          },
        }
      : { tag: "Valid", value },
  encoder: (value) => value,
});

export function editorUrl(editor: Editor, location: EditorLocation): string {
  const replacements: Record<(typeof EDITOR_PLACEHOLDERS)[number], string> = {
    "{file}": fileToUrlPath(location.file),
    "{line}": location.line.toString(),
    "{column}": location.column.toString(),
    "{line0}": Math.max(0, location.line - 1).toString(),
    "{column0}": Math.max(0, location.column - 1).toString(),
  };
  return editorTemplate(editor).replace(
    /\{(?:file|line|column|line0|column0)\}/g,
    (placeholder) => replacements[placeholder as keyof typeof replacements],
  );
}

// Like the path of a `file://` URL: Always starts with a slash, uses forward
// slashes (also on Windows), and is percent-encoded so that it works both in
// the path and in the query string of a URL. Colons are kept, for Windows
// drive letters: `C:\Users\you` → `/C:/Users/you`.
function fileToUrlPath(file: string): string {
  const slashes = file.replace(/\\/g, "/");
  const absolute = slashes.startsWith("/") ? slashes : `/${slashes}`;
  return absolute
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
    .join("/");
}
