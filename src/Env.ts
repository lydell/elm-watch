export type Env = Record<string, string | undefined>;

// Disable colored output.
// Type: Check if defined and ignore value.
export const NO_COLOR = "NO_COLOR";

// This enables `logger.debug()` calls (written to stderr). Since the stuff
// written to stdout uses cursor movements, you probably want to also set
// `__ELM_WATCH_NOT_TTY` or pipe to `cat` (if not a tty cursor movements are
// disabled), or redirect stderr to a file.
// Type: Check if defined and ignore value.
export const __ELM_WATCH_DEBUG = "__ELM_WATCH_DEBUG";

// See `__ELM_WATCH_DEBUG`.
export const __ELM_WATCH_NOT_TTY = "__ELM_WATCH_NOT_TTY";

// Used to print emojis even on Windows to be able to use the same test snapshots.
export const __ELM_WATCH_FANCY_EVEN_ON_WINDOWS =
  "__ELM_WATCH_FANCY_EVEN_ON_WINDOWS";

// Used in tests to print hardcoded durations and timings, for snapshots.
// Type: Check if defined and ignore value.
export const __ELM_WATCHED_MOCKED_TIMINGS = "__ELM_WATCHED_MOCKED_TIMINGS";

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
