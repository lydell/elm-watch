export type Env = Record<string, string | undefined>;

// Disable colored output.
// Type: Check if defined and ignore value.
export const NO_COLOR = "NO_COLOR";

// If set, enables clicking error locations in the browser to open them in your editor.
// Type: String of shell code.
export const ELM_WATCH_OPEN_EDITOR = "ELM_WATCH_OPEN_EDITOR";

// By default, elm-watch’s HTTP server is run on `127.0.0.1`, which restricts it
// to just your computer. By setting this variable to `0.0.0.0` you can expose
// the server on the local network (to test on your phone, for example).
// Type: IP address.
export const ELM_WATCH_HOST = "ELM_WATCH_HOST";

// This lets you override "webSocketUrl" in elm-watch.json, for cases where you
// need to set it dynamically. For example, you might want to set a certain port
// but keep the host name dynamic (if you run a remote dev container).
// Type: URL starting with ws: or wss:.
export const ELM_WATCH_WEBSOCKET_URL = "ELM_WATCH_WEBSOCKET_URL";

// Hosts to allow in addition to "allowedHosts" in elm-watch.json, for cases
// where you need to set them dynamically. For example, if every developer has
// their own tunnel domain.
// Type: Comma-separated hostnames.
export const ELM_WATCH_ALLOWED_HOSTS = "ELM_WATCH_ALLOWED_HOSTS";

// Set by `node --watch` for the process it runs (undocumented). We put stdin in
// raw mode, so ctrl+c does not send SIGINT, which means that `node --watch`
// never learns about it and keeps waiting for file changes after we exit. When
// this is set, we send SIGINT to `node --watch` after exiting on ctrl+c, so
// that a single ctrl+c exits both. (On Windows, this kills `node --watch`
// abruptly instead, which is fine since it has nothing to clean up.)
// If Node.js stops setting this, you just need to press ctrl+c twice.
// Type: Check if "1".
export const WATCH_REPORT_DEPENDENCIES = "WATCH_REPORT_DEPENDENCIES";

// If the `ELM_WATCH_OPEN_EDITOR` takes this long, it is killed.
// Type: Number.
export const __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS =
  "__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS";

// This enables `terminal.debug()` calls (written to stderr). Since the stuff
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

// Used to make tests work on multiple computers. CI and other developers’
// computers should have at least 2 cores/threads, while some might have many
// more than that.
// Type: Number.
export const __ELM_WATCH_MAX_PARALLEL = "__ELM_WATCH_MAX_PARALLEL";

// When killing `elm`, we don’t do it right away. Instead, we give it a chance
// to finish. The thinking is that this can reduce corruption of elm-stuff.
// Used in tests by not having to wait for so long.
// Type: Number.
export const __ELM_WATCH_ELM_TIMEOUT_MS = "__ELM_WATCH_ELM_TIMEOUT_MS";

// elm-watch waits a little bit after web socket connections and disconnections
// before acting, to batch bursts of connections. Used in tests to not have to
// wait for so long.
// Type: Number.
export const __ELM_WATCH_WEBSOCKET_EVENT_SLEEP_MS =
  "__ELM_WATCH_WEBSOCKET_EVENT_SLEEP_MS";

// Used in tests to quickly fall back to the default theme.
// Type: Number.
export const __ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS =
  "__ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS";

// Used in tests to test reusing of a recent terminal query.
// Type: Number.
export const __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS =
  "__ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS";
