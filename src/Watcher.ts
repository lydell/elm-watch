import * as fs from "fs";
import * as path from "path";

import { toError } from "./Helpers.ts";
import { type AbsolutePath, markAsAbsolutePath } from "./Types.ts";

// A small file watcher on top of `fs.watch` with `recursive: true`. Things to
// know about `fs.watch`:
//
// - The event type (`"rename"` or `"change"`) is not reliable. For example,
//   on macOS almost everything is `"rename"`, including saving a file in vim.
//   So we don’t use it. Instead we report whether the path exists or not.
// - Moving a directory into or out of a watched directory results in a single
//   event for the directory itself, not one per file inside it. So every
//   reported path must be treated as a potential directory.
// - Watching a path that does not exist throws. Watch roots (such as source
//   directories in elm.json) might not exist (yet), so we watch the closest
//   existing ancestor until they do.

export type WatcherEvent = {
  absolutePath: AbsolutePath;
  exists: boolean;
};

export type Watcher = {
  close: () => void;
};

// Atomic saves (write to a temporary file, then rename it over the original)
// can briefly make a file look removed. Wait this long before reporting a
// missing path as removed, to see if it comes back.
const REMOVAL_DELAY_MS = 50;

// Note: The trailing separator is important: It makes it possible to get
// notifications of a removed elm-stuff folder, while ignoring everything that
// happens _inside_ that folder. For `.stack-work/`, see
// https://docs.haskellstack.org/en/stable/topics/stack_work/ and
// https://github.com/lydell/elm-watch/issues/106.
const IGNORE = /(?:^|[/\\])(?:elm-stuff|node_modules|\.stack-work)[/\\]/;

type RootState =
  | { tag: "Watching"; fsWatcher: fs.FSWatcher }
  | { tag: "WaitingForRoot"; fsWatcher: fs.FSWatcher | undefined };

export function watch(
  roots: Array<AbsolutePath>,
  onEvent: (event: WatcherEvent) => void,
  onError: (error: Error) => void,
): Watcher {
  const rootStates = new Map<AbsolutePath, RootState>();
  const pendingRemovals = new Map<AbsolutePath, NodeJS.Timeout>();
  let closed = false;

  const report = (absolutePath: AbsolutePath): void => {
    if (closed) {
      return;
    }

    const pending = pendingRemovals.get(absolutePath);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingRemovals.delete(absolutePath);
    }

    if (fs.existsSync(absolutePath)) {
      onEvent({ absolutePath, exists: true });
      return;
    }

    pendingRemovals.set(
      absolutePath,
      setTimeout(() => {
        pendingRemovals.delete(absolutePath);
        if (closed) {
          return;
        }
        onEvent({ absolutePath, exists: fs.existsSync(absolutePath) });
      }, REMOVAL_DELAY_MS),
    );
  };

  const closeRoot = (root: AbsolutePath): void => {
    rootStates.get(root)?.fsWatcher?.close();
    rootStates.delete(root);
  };

  const watchRoot = (root: AbsolutePath): void => {
    closeRoot(root);
    let fsWatcher: fs.FSWatcher;
    try {
      // `ignore` was added in Node.js 24.14.0 (and is missing in our version
      // of @types/node). Older versions ignore the option, so we filter in the
      // listener as well.
      const options = { recursive: true, ignore: IGNORE };
      fsWatcher = fs.watch(root, options, (_eventType, filename) => {
        if (filename === null) {
          // The OS did not tell us what changed (for example, because of
          // an event queue overflow). Report the whole root.
          report(root);
        } else if (!IGNORE.test(filename)) {
          report(markAsAbsolutePath(path.join(root, filename)));
        }
        if (!fs.existsSync(root)) {
          waitForRoot(root);
          report(root);
        }
      });
    } catch (unknownError) {
      const error = toError(unknownError);
      if (isMissingError(error)) {
        waitForRoot(root);
      } else {
        // Report asynchronously, since the caller might not be ready to
        // handle errors until `watch` has returned.
        process.nextTick(() => {
          onError(error);
        });
      }
      return;
    }
    fsWatcher.on("error", (error) => {
      if (fs.existsSync(root)) {
        onError(error);
      } else {
        // For example, on Windows `EPERM` is emitted when the watched
        // directory is removed.
        waitForRoot(root);
        report(root);
      }
    });
    rootStates.set(root, { tag: "Watching", fsWatcher });
  };

  const waitForRoot = (root: AbsolutePath): void => {
    closeRoot(root);
    if (closed) {
      return;
    }
    if (fs.existsSync(root)) {
      watchRoot(root);
      report(root);
      return;
    }
    const ancestor = findClosestExistingAncestor(root);
    let fsWatcher: fs.FSWatcher | undefined = undefined;
    if (ancestor !== undefined) {
      try {
        fsWatcher = fs.watch(ancestor, () => {
          // Something happened in the closest existing ancestor. The root
          // might exist now, or at least a directory closer to it.
          if (findClosestExistingAncestor(root) !== ancestor) {
            waitForRoot(root);
          }
        });
        fsWatcher.on("error", () => {
          waitForRoot(root);
        });
      } catch (unknownError) {
        if (isMissingError(toError(unknownError))) {
          // The ancestor was removed just now. Try again.
          waitForRoot(root);
          return;
        }
        // Otherwise we can’t watch the ancestor, and won’t notice when the
        // root is created.
      }
    }
    rootStates.set(root, { tag: "WaitingForRoot", fsWatcher });
    // The root (or a directory closer to it) might have been created while
    // setting up the watcher.
    if (findClosestExistingAncestor(root) !== ancestor) {
      waitForRoot(root);
    }
  };

  for (const root of roots) {
    watchRoot(root);
  }

  return {
    close: () => {
      closed = true;
      for (const root of rootStates.keys()) {
        closeRoot(root);
      }
      for (const timeoutId of pendingRemovals.values()) {
        clearTimeout(timeoutId);
      }
      pendingRemovals.clear();
    },
  };
}

// Returns the closest existing directory that is `absolutePath` itself or one
// of its ancestors.
function findClosestExistingAncestor(
  absolutePath: AbsolutePath,
): AbsolutePath | undefined {
  let current = absolutePath;
  for (;;) {
    try {
      if (fs.statSync(current).isDirectory()) {
        return current;
      }
    } catch {
      // Keep going up.
    }
    const parent = markAsAbsolutePath(path.dirname(current));
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function isMissingError(error: Error): boolean {
  const { code } = error as Error & { code?: unknown };
  return code === "ENOENT" || code === "ENOTDIR";
}
