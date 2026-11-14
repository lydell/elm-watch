import * as fs from "fs";
import * as path from "path";

import { toError } from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import { MODULE_NAME_PART } from "./Parser.ts";
import { type AbsolutePath, markAsAbsolutePath } from "./Types.ts";

// A small file watcher on top of `fs.watch`. Things to know about `fs.watch`:
//
// - The event type (`"rename"` or `"change"`) is not reliable. For example,
//   on macOS almost everything is `"rename"`, including saving a file in vim.
//   So we don’t use it. Instead we only report the path. The caller can check
//   if it exists. (Except for one Windows quirk, see `isDirectoryChange`.)
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

export type Watcher = {
  close: () => void;
};

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
  onEvent: (absolutePath: AbsolutePath) => void,
  onError: (error: Error) => void,
): Watcher {
  const rootStates = new Map<AbsolutePath, RootState>();
  let closed = false;

  const report = (absolutePath: AbsolutePath): void => {
    if (!closed) {
      onEvent(absolutePath);
    }
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
      // On Windows, removing the root results in an endless stream of events
      // with the absolute path of the root as `filename`. Those must reach the
      // listener, which stops watching. Ignoring them would busy-loop forever.
      const options = {
        recursive: watchDir.tag !== "Shallow",
        ignore: (filename: string) =>
          !path.isAbsolute(filename) && ignore(filename),
      };
      fsWatcher = fs.watch(root, options, (eventType, filename) => {
        if (!fs.existsSync(root)) {
          // The root itself was removed. Everything inside it is gone too, so
          // reporting the root is enough.
          waitForRoot(watchDir);
          report(root);
        } else if (filename === null) {
          // The OS did not tell us what changed (for example, because of
          // an event queue overflow). Report the whole root.
          report(root);
        } else if (!ignore(filename)) {
          const absolutePath = markAsAbsolutePath(path.join(root, filename));
          if (isDirectoryChange(eventType, absolutePath)) {
            return;
          }
          // For events about the root itself, macOS gives the name of the root
          // as `filename`, which results in a bogus path. If it doesn’t exist,
          // report the root instead (which covers everything inside it anyway).
          report(
            filename === path.basename(root) && !fs.existsSync(absolutePath)
              ? root
              : absolutePath,
          );
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
  // Not using `path.relative`, since it is case insensitive on Windows, while
  // the ignore functions are case sensitive: `src/Sub` does not cover `src/sub`.
  const prefix = a.dir.endsWith(path.sep) ? a.dir : a.dir + path.sep;
  const relative =
    b.dir === a.dir
      ? ""
      : b.dir.startsWith(prefix)
        ? b.dir.slice(prefix.length)
        : undefined;
  return (
    relative !== undefined &&
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

// On Windows, writing a file inside a directory results in a `"change"` event
// for the directory itself – even when only watching the directory’s parent
// (shallow). Adding, moving and removing a directory results in `"rename"`.
// The files inside are reported separately (if watched), so the directory
// event is just noise. Worse, it would restart elm-watch every time a file is
// written next to elm-watch.json (if its parent is watched).
function isDirectoryChange(eventType: string, absolutePath: string): boolean {
  if (!IS_WINDOWS || eventType !== "change") {
    return false;
  }
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

function isMissingError(error: Error): boolean {
  const { code } = error as Error & { code?: unknown };
  return code === "ENOENT" || code === "ENOTDIR";
}
