import * as Codec from "tiny-decoders";

// Editors that can be opened via a URL, such as `vscode://file/path:1:2`.
// This module is used both by the server and by the browser UI.
//
// The editor chosen in the browser UI or the terminal is one of the presets.
// Its ID is stored in elm-stuff/elm-watch/stuff.json, and sent over the
// WebSocket. Other editors are set up with a URL template (or a command) in
// the `ELM_WATCH_OPEN_EDITOR` environment variable.

export type EditorPreset = {
  id: string;
  name: string;
  template: string;
};

// The most common editors for Elm.
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

// Schemes for web pages and local files, rather than for apps. Most likely a
// mistake, since the URL should open an editor.
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

// `ELM_WATCH_OPEN_EDITOR` is either a URL template or a command. Anything
// starting like a URL is a URL – then `validateEditorUrlTemplate` can tell
// what’s wrong with it, rather than trying to run it as a command. At least
// two characters in the scheme, so that `C://…` is a Windows path.
export function isEditorUrl(string: string): boolean {
  return /^[a-z][a-z\d+.-]+:\/\//i.test(string);
}

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

export function findPreset(id: string): EditorPreset | undefined {
  return EDITOR_PRESETS.find((preset) => preset.id === id);
}

// The ID of a preset.
export const EditorPresetId = Codec.flatMap(Codec.string, {
  decoder: (value) =>
    findPreset(value) === undefined
      ? {
          tag: "DecoderError",
          error: {
            tag: "custom",
            path: [],
            message: "Expected an editor preset ID",
            got: value,
          },
        }
      : { tag: "Valid", value },
  encoder: (value) => value,
});

export function editorUrl(template: string, location: EditorLocation): string {
  const replacements: Record<(typeof EDITOR_PLACEHOLDERS)[number], string> = {
    "{file}": fileToUrlPath(location.file),
    "{line}": location.line.toString(),
    "{column}": location.column.toString(),
    "{line0}": Math.max(0, location.line - 1).toString(),
    "{column0}": Math.max(0, location.column - 1).toString(),
  };
  return template.replace(
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
