import * as fs from "fs";
import * as path from "path";

import { toError } from "./Helpers.ts";
import { MODULE_NAME_PART } from "./Parser.ts";
import { type AbsolutePath, markAsAbsolutePath } from "./Types.ts";

// A small file watcher on top of `fs.watch`. Things to know about `fs.watch`:
//
// - The event type (`"rename"` or `"change"`) is not reliable. For example,
//   on macOS almost everything is `"rename"`, including saving a file in vim.
//   So we don’t use it. Instead we report whether the path exists or not.
// - Moving a directory into or out of a watched directory results in a single
//   event for the directory itself, not one per file inside it. So every
//   reported path must be treated as a potential directory.
// - Watching a path that does not exist throws. Watched directories (such as
//   source directories in elm.json) might not exist (yet), so we watch the
//   closest existing ancestor until they do.
// - Recursively watching a large directory can be expensive (on Linux, Node.js
//   adds one watcher per directory). So we only watch recursively where we need
//   to: https://github.com/lydell/elm-watch/issues/106

export type WatchDir = {
  tag: "SourceDirectory" | "StaticFilesDir" | "Shallow";
  dir: AbsolutePath;
};

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

// The filenames passed to these are relative to the watched directory. The last
// part of the filename can be both a file and a directory – we can’t know.
// `fs.watch` calls these for directories before descending into them (on Linux,
// where it matters), so if a directory is ignored, so is everything inside.
const ignoreFunctions: Record<WatchDir["tag"], (filename: string) => boolean> =
  {
    // Elm module names map to paths in source directories, so only directories
    // that are valid module name parts can contain relevant files. That rules
    // out things like `elm-stuff`, `node_modules`, `.git` and `.stack-work`.
    SourceDirectory: (filename) =>
      filename
        .split(/[/\\]/)
        .slice(0, -1)
        .some((part) => !MODULE_NAME_PART.test(part)),
    // Any file could be served from the static files directory, but there is
    // no point in watching the contents of these.
    StaticFilesDir: (filename) =>
      /(?:^|[/\\])(?:elm-stuff|node_modules)[/\\]/.test(filename),
    Shallow: () => false,
  };

type RootState =
  | { tag: "Watching"; fsWatcher: fs.FSWatcher }
  | { tag: "WaitingForRoot"; fsWatcher: fs.FSWatcher | undefined };

export function watch(
  watchDirs: Array<WatchDir>,
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

  const watchRoot = (watchDir: WatchDir): void => {
    const root = watchDir.dir;
    closeRoot(root);
    const ignore = ignoreFunctions[watchDir.tag];
    let fsWatcher: fs.FSWatcher;
    try {
      // `ignore` was added in Node.js 24.14.0 (and is missing in our version
      // of @types/node). Older versions ignore the option, so we filter in the
      // listener as well.
      const options = { recursive: watchDir.tag !== "Shallow", ignore };
      fsWatcher = fs.watch(root, options, (_eventType, filename) => {
        if (filename === null) {
          // The OS did not tell us what changed (for example, because of
          // an event queue overflow). Report the whole root.
          report(root);
        } else if (!ignore(filename)) {
          report(markAsAbsolutePath(path.join(root, filename)));
        }
        if (!fs.existsSync(root)) {
          waitForRoot(watchDir);
          report(root);
        }
      });
    } catch (unknownError) {
      const error = toError(unknownError);
      if (isMissingError(error)) {
        waitForRoot(watchDir);
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
        waitForRoot(watchDir);
        report(root);
      }
    });
    rootStates.set(root, { tag: "Watching", fsWatcher });
  };

  const waitForRoot = (watchDir: WatchDir): void => {
    const root = watchDir.dir;
    closeRoot(root);
    if (closed) {
      return;
    }
    if (fs.existsSync(root)) {
      watchRoot(watchDir);
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
            waitForRoot(watchDir);
          }
        });
        fsWatcher.on("error", () => {
          waitForRoot(watchDir);
        });
      } catch (unknownError) {
        if (isMissingError(toError(unknownError))) {
          // The ancestor was removed just now. Try again.
          waitForRoot(watchDir);
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
      waitForRoot(watchDir);
    }
  };

  for (const watchDir of removeCoveredWatchDirs(watchDirs)) {
    watchRoot(watchDir);
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

// Watching the same thing twice would result in duplicate events.
export function removeCoveredWatchDirs(
  watchDirs: Array<WatchDir>,
): Array<WatchDir> {
  return watchDirs.filter(
    (watchDir, index) =>
      !watchDirs.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          covers(other, watchDir) &&
          // If they cover each other, keep the first one.
          (otherIndex < index || !covers(watchDir, other)),
      ),
  );
}

function covers(a: WatchDir, b: WatchDir): boolean {
  const relative = path.relative(a.dir, b.dir);
  const isInside =
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative);
  return (
    isInside &&
    looseness[a.tag] >= looseness[b.tag] &&
    (a.tag === "Shallow"
      ? relative === ""
      : // Use a dummy file name to check if the directory itself is ignored.
        !ignoreFunctions[a.tag](path.join(relative, "x")))
  );
}

// A watch dir can only cover another if it ignores less.
const looseness: Record<WatchDir["tag"], number> = {
  Shallow: 0,
  SourceDirectory: 1,
  StaticFilesDir: 2,
};

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
