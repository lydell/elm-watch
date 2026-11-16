import * as readline from "readline";
import { PassThrough, Writable } from "stream";

// A one-line text field in the terminal, while stdin stays in raw mode (which
// might not be ours to turn off, when elm-watch is used via the JavaScript
// API). Node’s `readline` does the editing (arrow keys, home/end, ctrl+u, ctrl+w,
// paste …), but it doesn’t read stdin itself: We feed it what we read. Its
// output is thrown away, since we render the whole screen ourselves (the error
// view), including the line and the cursor.
export type LineEditor = {
  readonly line: string;
  // Index into `line`.
  readonly cursor: number;
  write: (data: string) => LineEditorEvent;
  close: () => void;
};

export type LineEditorEvent =
  | { tag: "Edited" }
  // Enter was pressed. The line is kept, for editing it again if it was invalid.
  | { tag: "Submitted"; line: string }
  // ctrl+d on an empty line.
  | { tag: "Ended" };

export function makeLineEditor(initialLine: string): LineEditor {
  const input = new PassThrough();
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
    historySize: 0,
    prompt: "",
  });

  // `readline` handles keypresses synchronously when written to `input`, so we
  // can collect what happened during each write.
  let event: LineEditorEvent = { tag: "Edited" };
  let closedByUs = false;
  rl.on("line", (line) => {
    if (event.tag === "Edited") {
      event = { tag: "Submitted", line };
    }
    rl.write(line);
  });
  rl.on("close", () => {
    if (!closedByUs) {
      event = { tag: "Ended" };
    }
  });
  // By default, ctrl+z suspends the whole process. elm-watch only has one
  // screen, so ignore it instead.
  rl.on("SIGTSTP", () => {
    // Do nothing.
  });

  rl.write(initialLine);

  return {
    get line() {
      return rl.line;
    },
    get cursor() {
      return rl.cursor;
    },
    write(data) {
      event = { tag: "Edited" };
      input.write(data);
      return event;
    },
    close() {
      closedByUs = true;
      rl.close();
    },
  };
}
