import { EMOJI, type EmojiName, emojiWidthFix } from "./Compile.ts";
import { EDITOR_PRESETS, type EditorPreset } from "./Editor.ts";
import { ELM_WATCH_OPEN_EDITOR } from "./Env.ts";
import * as Errors from "./Errors.ts";
import {
  canSwitchTarget,
  type ErrorGroup,
  getErrorNumber,
  getOpenEditorLocation,
  getSelectedError,
  getSelectedTarget,
  makeErrorGroup,
  type NavigationKey,
  type Selection,
} from "./ErrorSelection.ts";
import { bold, dim, removeColor } from "./Helpers.ts";
import type { TerminalConfig } from "./Terminal.ts";

// In the terminal, errors are shown one at a time, and you navigate between
// them with the keyboard. See ErrorSelection.ts for which error is selected.

export type ErrorViewTarget = ErrorGroup<ErrorViewError>;

type ErrorViewError = {
  id: string;
  template: Errors.ErrorTemplate;
  location: Errors.ErrorLocation | undefined;
};

export type ErrorViewState = {
  showAll: boolean;
  // Long code excerpts are collapsed by default. See CollapseExcerpts.ts.
  expanded: boolean;
  selection: Selection | undefined;
  // Set while choosing an editor for opening error locations in. Only presets
  // can be chosen in the terminal. “Other” shows how to use other editors.
  editorChooser: { showOther: boolean } | undefined;
};

export type ErrorViewKey =
  | NavigationKey
  | "OpenEditor"
  | "ChangeEditor"
  | "Cancel"
  | Digit
  | "ToggleExpanded"
  | "ToggleShowAll";

export type Digit = `Digit${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

const DIGITS: Array<[string, Digit]> = (
  [1, 2, 3, 4, 5, 6, 7, 8, 9] as const
).map((digit) => [digit.toString(), `Digit${digit}`]);

export function isDigit(key: ErrorViewKey): key is Digit {
  return key.startsWith("Digit");
}

export function digitToNumber(digit: Digit): number {
  return Number(digit.slice("Digit".length));
}

// What the error view needs to know about opening errors in an editor.
export type ErrorViewEditor = {
  // The chosen preset, which takes precedence over `ELM_WATCH_OPEN_EDITOR`.
  current: EditorPreset | undefined;
  // Whether `ELM_WATCH_OPEN_EDITOR` is set. Then it can be chosen instead of
  // the presets (in place of “Other”).
  envSet: boolean;
  chooser: { showOther: boolean } | undefined;
  commandHint: string;
};

const KEYS: Array<[string, ErrorViewKey]> = [
  ["\x1B[C", "NextError"],
  ["l", "NextError"],
  ["\x1B[D", "PreviousError"],
  ["h", "PreviousError"],
  ["\x1B[B", "NextFile"],
  ["j", "NextFile"],
  ["\x1B[A", "PreviousFile"],
  ["k", "PreviousFile"],
  ["\t", "NextTarget"],
  ["\x1B[Z", "PreviousTarget"],
  ["\r", "OpenEditor"],
  ["o", "OpenEditor"],
  ["e", "ChangeEditor"],
  ...DIGITS,
  [" ", "ToggleExpanded"],
  ["a", "ToggleShowAll"],
  // Last, since the escape sequences above start with Escape too.
  ["\x1B", "Cancel"],
];

// Several keys can arrive in one chunk if typed quickly. If anything in the
// chunk is unknown (such as a response to a terminal query), ignore it all.
export function parseKeys(data: string): Array<ErrorViewKey> {
  const keys: Array<ErrorViewKey> = [];
  let rest = data;
  while (rest !== "") {
    const match = KEYS.find(([sequence]) => rest.startsWith(sequence));
    if (match === undefined) {
      return [];
    }
    const [sequence, key] = match;
    keys.push(key);
    rest = rest.slice(sequence.length);
  }
  return keys;
}

// `targetName` can also be the source of external errors (see
// ExternalErrors.ts).
export function makeErrorViewTarget(
  targetName: string,
  templates: Array<Errors.ErrorTemplate>,
): ErrorViewTarget {
  return makeErrorGroup(
    targetName,
    templates.map((template) => ({
      id: Errors.toPlainString(template),
      template,
      location: Errors.getErrorLocation(template),
    })),
  );
}

// Everything below the status lines and server line: The selected error, the
// info message line, and where you are followed by which keys to press (like
// the footer in the browser). The keys are last, so they are right next to the
// cursor and easy to find. Only the error area changes when switching to
// showing all errors (see `renderShowAll`).
export function render({
  terminalConfig,
  expanded,
  selection,
  targets,
  notice,
  infoLine,
  editor,
}: {
  terminalConfig: TerminalConfig;
  expanded: boolean;
  selection: Selection;
  targets: Array<ErrorViewTarget>;
  notice: string | undefined;
  infoLine: string | undefined;
  editor: ErrorViewEditor;
}): string {
  const target = getSelectedTarget(selection, targets);
  const hasOtherTargetsWithErrors = canSwitchTarget(selection, targets);
  const error = getSelectedError(selection, targets);
  const noticeLines = notice === undefined ? [] : [notice, ""];
  const infoLines = infoLine === undefined ? [] : [infoLine, ""];

  if (target === undefined || error === undefined) {
    return [
      ...noticeLines,
      ...infoLines,
      keyHints(
        terminalConfig.columns,
        withEmoji(
          terminalConfig,
          "Success",
          `${bold(selection.targetName)} has no errors.`,
        ),
        [
          hasOtherTargetsWithErrors
            ? ["tab", "next target with errors"]
            : undefined,
          ["a", "show all"],
        ],
      ),
    ].join("\n");
  }

  const errorNumber = getErrorNumber(selection, target);

  const position = [
    `error ${errorNumber}/${target.numErrors}`,
    target.files.length > 1
      ? `file ${selection.fileIndex + 1}/${target.files.length}`
      : undefined,
  ]
    .flatMap((part) => part ?? [])
    .join("   ");

  const canOpenEditor = getOpenEditorLocation(error.location) !== undefined;
  const openInName = editor.current?.name ?? "editor";
  // While choosing an editor, the other keys are paused.
  const chooser = canOpenEditor ? editor.chooser : undefined;

  return [
    Errors.toTerminalString(
      error.template,
      terminalConfig.columns,
      terminalConfig.noColor,
      !expanded,
    ),
    "",
    ...noticeLines,
    ...infoLines,
    ...(chooser === undefined
      ? []
      : [renderEditorChooser(terminalConfig, editor, chooser), ""]),
    keyHints(
      terminalConfig.columns,
      withEmoji(terminalConfig, "Error", position),
      chooser !== undefined
        ? [["esc", "cancel"]]
        : [
            [
              [
                ["←", errorNumber > 1],
                ["→", errorNumber < target.numErrors],
              ],
              "error",
            ],
            [
              [
                ["↑", selection.fileIndex > 0],
                ["↓", selection.fileIndex + 1 < target.files.length],
              ],
              "file",
            ],
            hasOtherTargetsWithErrors ? ["tab", "target"] : undefined,
            canOpenEditor ? ["enter", `open in ${openInName}`] : undefined,
            canOpenEditor && (editor.current !== undefined || editor.envSet)
              ? ["e", "change editor"]
              : undefined,
            Errors.isCollapsible(error.template)
              ? ["space", expanded ? "collapse" : "expand"]
              : undefined,
            ["a", "show all"],
          ],
    ),
  ].join("\n");
}

// Shown above the key hints when pressing Enter without having chosen an
// editor, or when pressing “e” to change editor. The current editor is bold.
function renderEditorChooser(
  terminalConfig: TerminalConfig,
  editor: ErrorViewEditor,
  { showOther }: { showOther: boolean },
): string {
  const { current, envSet } = editor;
  return [
    "Which editor should I open this in?",
    keyHints(terminalConfig.columns, undefined, [
      ...EDITOR_PRESETS.map((preset, index): [string, string] => [
        (index + 1).toString(),
        current?.id === preset.id ? bold(preset.name) : preset.name,
      ]),
      [
        (EDITOR_PRESETS.length + 1).toString(),
        envSet
          ? current === undefined
            ? bold(ELM_WATCH_OPEN_EDITOR)
            : ELM_WATCH_OPEN_EDITOR
          : "Other",
      ],
    ]),
    ...(showOther
      ? ["", Errors.openEditorOtherForTerminal(editor.commandHint)]
      : []),
  ].join("\n");
}

// Like `render`, but with all errors (of all targets).
export function renderShowAll({
  terminalConfig,
  errorStrings,
  infoLine,
}: {
  terminalConfig: TerminalConfig;
  errorStrings: Array<string>;
  infoLine: string | undefined;
}): string {
  const numErrors = errorStrings.length;
  return [
    ...(numErrors === 0 ? [] : [errorStrings.join("\n\n"), ""]),
    ...(infoLine === undefined ? [] : [infoLine, ""]),
    keyHints(
      terminalConfig.columns,
      withEmoji(
        terminalConfig,
        "Error",
        `${numErrors} error${numErrors === 1 ? "" : "s"}`,
      ),
      [["a", "show one error at a time"]],
    ),
  ].join("\n");
}

// Text with an emoji at the start of the line (in fancy mode), and its width.
function withEmoji(
  terminalConfig: TerminalConfig,
  emojiName: EmojiName,
  text: string,
): [text: string, width: number] {
  const width = Array.from(removeColor(text)).length;
  return terminalConfig.fancy
    ? [
        `${emojiWidthFix({
          emoji: EMOJI[emojiName].emoji,
          column: 3,
          isTTY: terminalConfig.isTTY,
        })} ${text}`,
        // The emoji takes two columns, plus the space after it.
        width + 3,
      ]
    : [text, width];
}

// A key, or several keys with whether each of them does anything right now.
type HintKeys = string | Array<[key: string, enabled: boolean]>;

// Styled like in run-pty: [key] label
// Keys that don’t do anything right now are dimmed (and the label too, if none
// of the keys do anything).
// If the hints don’t fit on one line, they wrap between hints rather than in
// the middle of one. The hints can start on the same line as some text (`first`,
// with its width).
function keyHints(
  columns: number,
  first: [text: string, width: number] | undefined,
  hints: Array<[keys: HintKeys, label: string] | undefined>,
): string {
  const lines: Array<string> = [];
  let [line, lineWidth] = first ?? ["", 0];
  let separator = "  ";
  for (const hint of renderKeyHints(hints)) {
    const width = Array.from(removeColor(hint)).length;
    if (line === "") {
      line = hint;
      lineWidth = width;
    } else if (lineWidth + separator.length + width <= columns) {
      line += separator + hint;
      lineWidth += separator.length + width;
    } else {
      lines.push(line);
      line = hint;
      lineWidth = width;
    }
    separator = "   ";
  }
  lines.push(line);
  return lines.join("\n");
}

function renderKeyHints(
  hints: Array<[keys: HintKeys, label: string] | undefined>,
): Array<string> {
  return hints.flatMap((hint) => {
    if (hint === undefined) {
      return [];
    }
    const [keys, label] = hint;
    const keysArray: Array<[string, boolean]> =
      typeof keys === "string" ? [[keys, true]] : keys;
    const styledKeys = keysArray
      .map(([key, enabled]) => (enabled ? bold(key) : dim(key)))
      .join("");
    const anyEnabled = keysArray.some(([, enabled]) => enabled);
    return [
      `${dim("[")}${styledKeys}${dim("]")} ${anyEnabled ? label : dim(label)}`,
    ];
  });
}
