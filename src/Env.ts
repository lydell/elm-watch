export type Env = Record<string, string | undefined>;

// Disable colored output.
// Type: Check if defined and ignore value.
export const NO_COLOR = "NO_COLOR";

// If set, enables clicking error locations in the browser to open them in your editor.
// Type: String of shell code.
export const ELM_WATCH_OPEN_EDITOR = "ELM_WATCH_OPEN_EDITOR";

// If set, elm-watch exits if stdin ends. https://github.com/evanw/esbuild/pull/1449
// Type: Check if defined and ignore value.
export const ELM_WATCH_EXIT_ON_STDIN_END = "ELM_WATCH_EXIT_ON_STDIN_END";

// If the `ELM_WATCH_OPEN_EDITOR` takes this long, it is killed.
// Type: Number.
export const __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS =
  "__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS";

// This enables `logger.debug()` calls (written to stderr). Since the stuff
// written to stdout uses cursor movements, you probably want to also set
// `__ELM_WATCH_NOT_TTY` or pipe to `cat` (if not a tty cursor movements are
// disabled), or redirect stderr to a file.
// Type: Check if defined and ignore value.
export const __ELM_WATCH_DEBUG = "__ELM_WATCH_DEBUG";

// See `__ELM_WATCH_DEBUG`.
export const __ELM_WATCH_NOT_TTY = "__ELM_WATCH_NOT_TTY";

// _Windows Terminal_ supports emojis, but cmd.exe and the old PowerShell terminal do not.
// This detects Windows Terminal so they get fancy output: https://github.com/microsoft/terminal/issues/1040
// Also used to print emojis even on Windows to be able to use the same test snapshots.
export const WT_SESSION = "WT_SESSION";

// Used in tests to print hardcoded durations and timings, for snapshots.
// Type: Check if defined and ignore value.
export const __ELM_WATCH_MOCKED_TIMINGS = "__ELM_WATCH_MOCKED_TIMINGS";

// Used in tests to exit on error (instead of continuing watching).
// Type: Check if defined and ignore value.
export const __ELM_WATCH_EXIT_ON_ERROR = "__ELM_WATCH_EXIT_ON_ERROR";

// Used to stabilize tests. See tests/Helpers.ts.
// Type: Number.
export const __ELM_WATCH_LOADING_MESSAGE_DELAY =
  "__ELM_WATCH_LOADING_MESSAGE_DELAY";

// Used to speed up tests by not having to wait for a long time to test worker limiting.
// Type: Number.
export const __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS =
  "__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS";

// Used in tests to exit on first worker limit (instead of continuing watching).
// Type: Check if defined and ignore value.
export const __ELM_WATCH_EXIT_ON_WORKER_LIMIT =
  "__ELM_WATCH_EXIT_ON_WORKER_LIMIT";

// Used to make tests work on multiple computers. CI and other developers’
// computers should have at least 2 cores/threads, while some might have many
// more than that.
// Type: Number.
export const __ELM_WATCH_MAX_PARALLEL = "__ELM_WATCH_MAX_PARALLEL";

// Used to test ElmWatchDummy.elm errors without affecting other tests.
export const __ELM_WATCH_TMP_DIR = "__ELM_WATCH_TMP_DIR";

// When killing `elm`, we don’t do it right away. Instead, we give it a chance
// to finish. The thinking is that this can reduce corruption of elm-stuff.
// Used in tests by not having to wait for so long.
// Type: Number.
export const __ELM_WATCH_ELM_TIMEOUT_MS = "__ELM_WATCH_ELM_TIMEOUT_MS";

// Used in tests to quickly fall back to the default theme.
// Type: Number.
export const __ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS =
  "__ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS";

// Used in tests to test reusing of a recent terminal query.
// Type: Number.
export const __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS =
  "__ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS";
