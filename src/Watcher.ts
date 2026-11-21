import * as crypto from "crypto";
import { EventEmitter } from "events";
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
// - On Linux, inotify watches the directory itself, not the path. If a watched
//   directory is replaced (removed or moved away, and created again) before we
//   handle the event, the old watcher keeps watching the old directory. Moving
//   the directory away doesn’t even result in an event for recursive watchers.
//   So on Linux we also watch the parent directory, and start over on any
//   event about the watched directory there. (Comparing inode numbers is not
//   enough: ext4 reuses the inode number for a directory that is removed and
//   created again.) Node.js’ recursive watching on Linux (one inotify watcher
//   per directory) has the same problem for directories inside the watched
//   directory: https://github.com/nodejs/node/issues/67329 So on Linux we do
//   that ourselves instead, see `watchTreeOnLinux`.
// - On Windows, the watcher follows the watched directory if it is moved away,
//   and reports nothing about it. So on Windows we also watch the parent
//   directory, and start over if the watched directory has been replaced.
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
    StaticFilesDir: (filename) => isIgnoredStaticFile(filename),
    Shallow: () => false,
  };

// Other watchers can still report paths inside ignored directories, such as
// the shallow watcher of elm-stuff/ (see Project.ts).
export function isIgnoredStaticFile(filename: string): boolean {
  return /(?:^|[/\\])(?:elm-stuff|node_modules)[/\\]/.test(filename);
}

// `fs.FSWatcher` or the result of `watchTreeOnLinux`.
type WatcherHandle = {
  close: () => void;
  on: (eventName: "error", listener: (error: Error) => void) => unknown;
};

type RootState =
  | {
      tag: "Watching";
      fsWatcher: WatcherHandle;
      parentWatcher: fs.FSWatcher | undefined;
    }
  | { tag: "WaitingForRoot"; fsWatcher: fs.FSWatcher | undefined };

export function watch(
  watchDirs: Array<WatchDir>,
  onEvent: (absolutePath: AbsolutePath) => void,
  onError: (error: Error) => void,
): Watcher {
  const rootStates = new Map<AbsolutePath, RootState>();
  const isNewChange = makeDuplicateEventFilter();
  let closed = false;

  const report = (absolutePath: AbsolutePath): void => {
    if (!closed && isNewChange(absolutePath)) {
      onEvent(absolutePath);
    }
  };

  const closeRoot = (root: AbsolutePath): void => {
    const rootState = rootStates.get(root);
    rootState?.fsWatcher?.close();
    if (rootState?.tag === "Watching") {
      rootState.parentWatcher?.close();
    }
    rootStates.delete(root);
  };

  const watchRoot = (watchDir: WatchDir): void => {
    const root = watchDir.dir;
    closeRoot(root);
    const ignore = ignoreFunctions[watchDir.tag];
    // Before `fs.watch`: If the root is replaced in between, the first event
    // makes us start over. This catches some replacements, but not all, since
    // inode numbers can be reused (see `watchParent`).
    const identity = getIdentity(root);
    const isReplaced = (): boolean => getIdentity(root) !== identity;
    const onReplaced = (): void => {
      // Everything inside the root might have changed, so reporting the root
      // is enough. `waitForRoot` reports it if it exists (again).
      const removed = !fs.existsSync(root);
      waitForRoot(watchDir);
      if (removed) {
        report(root);
      }
    };
    let fsWatcher: WatcherHandle;
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
      const listener = (eventType: string, filename: string | null): void => {
        if (isReplaced()) {
          onReplaced();
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
      };
      fsWatcher =
        options.recursive && process.platform === "linux"
          ? watchTreeOnLinux(root, ignore, listener)
          : fs.watch(root, options, listener);
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
    rootStates.set(root, {
      tag: "Watching",
      fsWatcher,
      parentWatcher: watchParent(root, () => {
        // On Windows, changes inside the root also result in events about the
        // root in the parent, so check if the root was actually replaced.
        // (Windows file IDs are not reused like Linux inode numbers.)
        if (!IS_WINDOWS || isReplaced()) {
          onReplaced();
        }
      }),
    });
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

// Like `fs.watch(root, { recursive: true }, listener)` on Linux, but handles
// directories that are replaced quickly (see the top of this file). Watches
// every directory inside `root` (that isn’t ignored) non-recursively. On Linux,
// a directory gets events about its entries being created, removed, moved or
// getting new attributes – but not when something inside an entry changes. So
// an event about a watched directory in its parent means that it might have
// been replaced: Start over watching it. Throws like `fs.watch` if `root` can’t
// be watched.
function watchTreeOnLinux(
  root: AbsolutePath,
  // Takes a path relative to `root`.
  ignore: (filename: string) => boolean,
  listener: (eventType: string, filename: string | null) => void,
): WatcherHandle {
  const watchers = new Map<string, fs.FSWatcher>();
  const emitter = new EventEmitter<{ error: [Error] }>();
  let closed = false;

  const isIgnoredDirectory = (dir: string): boolean =>
    // Use a dummy file name to check if the directory itself is ignored.
    ignore(path.join(path.relative(root, dir), "x"));

  const closeTree = (dir: string): void => {
    const prefix = dir + path.sep;
    for (const [watchedDir, watcher] of watchers) {
      if (watchedDir === dir || watchedDir.startsWith(prefix)) {
        watcher.close();
        watchers.delete(watchedDir);
      }
    }
  };

  const onSubdirectoryError = (error: NodeJS.ErrnoException): void => {
    // The directory was removed just now (the parent gets an event about
    // that), or we aren’t allowed to read it (nothing to watch). Other errors,
    // such as running out of inotify watchers, are reported.
    if (
      !isMissingError(error) &&
      error.code !== "EACCES" &&
      error.code !== "EPERM"
    ) {
      emitter.emit("error", error);
    }
  };

  // Like Node.js: Watch the target of a symlink (non-recursively), and report
  // any change there as a change of the symlink.
  const watchSymlink = (link: string): void => {
    if (closed || watchers.has(link)) {
      return;
    }
    let watcher: fs.FSWatcher;
    try {
      watcher = fs.watch(link, (eventType) => {
        if (!closed) {
          listener(eventType, path.relative(root, link));
        }
      });
    } catch {
      // Broken link, or not allowed.
      return;
    }
    watcher.on("error", () => {
      closeTree(link);
    });
    watchers.set(link, watcher);
  };

  // Watches `dir` and all directories inside it (except ignored ones).
  const watchTree = (dir: string): void => {
    if (closed || watchers.has(dir)) {
      return;
    }
    let watcher: fs.FSWatcher;
    try {
      // Before reading the directory, so that nothing created in between is
      // missed.
      watcher = fs.watch(dir, (eventType, name) => {
        onEvent(dir, eventType, name);
      });
    } catch (unknownError) {
      if (dir === root) {
        throw unknownError;
      }
      onSubdirectoryError(toError(unknownError));
      return;
    }
    watcher.on("error", (error) => {
      if (dir === root) {
        emitter.emit("error", error);
      } else {
        closeTree(dir);
        onSubdirectoryError(error);
      }
    });
    watchers.set(dir, watcher);
    let entries: Array<fs.Dirent>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // Removed or unreadable. The parent gets an event if it was removed.
      return;
    }
    for (const entry of entries) {
      watchEntry(path.join(dir, entry.name), entry);
    }
  };

  const onEvent = (
    dir: string,
    eventType: string,
    name: string | null,
  ): void => {
    if (closed) {
      return;
    }
    if (name === null) {
      // The OS did not tell us what changed. Start over with the whole
      // directory, then report it.
      closeTree(dir);
      watchTree(dir);
      listener(eventType, dir === root ? null : path.relative(root, dir));
      return;
    }
    const absolutePath = path.join(dir, name);
    if (
      dir !== root &&
      name === path.basename(dir) &&
      !fs.existsSync(absolutePath)
    ) {
      // An event about `dir` itself (such as it being removed). Its parent
      // gets an event too, which takes care of it. (Events about the root
      // itself are handled by the listener.)
      return;
    }
    const stats = lstat(absolutePath);
    if (
      watchers.has(absolutePath) ||
      stats?.isDirectory() === true ||
      stats?.isSymbolicLink() === true
    ) {
      // A directory (or symlink) was created, removed, moved or replaced.
      // Start over with it before reporting it, so that changes inside it
      // right after the event aren’t missed.
      closeTree(absolutePath);
      if (stats !== undefined) {
        watchEntry(absolutePath, stats);
      }
    }
    listener(eventType, path.relative(root, absolutePath));
  };

  // `isDirectory` is false for symlinks, so we don’t descend into them (which
  // could result in cycles).
  const watchEntry = (
    absolutePath: string,
    entry: fs.Dirent | fs.Stats,
  ): void => {
    if (entry.isDirectory()) {
      if (!isIgnoredDirectory(absolutePath)) {
        watchTree(absolutePath);
      }
    } else if (
      entry.isSymbolicLink() &&
      !ignore(path.relative(root, absolutePath))
    ) {
      watchSymlink(absolutePath);
    }
  };

  watchTree(root);

  return {
    close: () => {
      closed = true;
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    },
    on: (eventName, errorListener) => emitter.on(eventName, errorListener),
  };
}

function lstat(absolutePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

// On Linux and Windows, calls `onEvent` for events about `root` in its parent
// directory: On Linux when `root` is created, removed, moved or gets new
// attributes (but not when something inside it changes). On Windows, changes
// inside `root` also result in events about `root`. Returns `undefined` if the
// parent can’t be watched: The watcher of the root itself still notices most
// changes to the root. Not needed on macOS (see the top of this file), where
// watching a directory also gets (and filters out) events for everything inside
// it.
function watchParent(
  root: AbsolutePath,
  onEvent: () => void,
): fs.FSWatcher | undefined {
  const parent = path.dirname(root);
  if ((process.platform !== "linux" && !IS_WINDOWS) || parent === root) {
    return undefined;
  }
  const basename = path.basename(root);
  try {
    const parentWatcher = fs.watch(parent, (_, filename) => {
      if (filename === null || filename === basename) {
        onEvent();
      }
    });
    parentWatcher.on("error", () => {
      parentWatcher.close();
    });
    return parentWatcher;
  } catch {
    return undefined;
  }
}

// Identifies a directory, so we can tell if it has been replaced by another one
// at the same path (unless the inode number was reused). `undefined` if it does
// not exist.
function getIdentity(absolutePath: AbsolutePath): string | undefined {
  try {
    const stats = fs.statSync(absolutePath, { throwIfNoEntry: false });
    return stats === undefined ? undefined : `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
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

// The same change can be reported more than once. For example, on macOS a
// single write is sometimes reported a second time ~50 ms later under load,
// which would cause an unnecessary compilation (or interrupt one). To skip such
// duplicates, we remember what each reported file looked like, and skip events
// where nothing changed since the last reported event for the same path.
export function makeDuplicateEventFilter(): (
  absolutePath: AbsolutePath,
) => boolean {
  const lastFileStates = new Map<AbsolutePath, string>();
  return (absolutePath) => {
    const fileState = getFileState(absolutePath);
    if (fileState === undefined) {
      lastFileStates.delete(absolutePath);
      return true;
    }
    if (lastFileStates.get(absolutePath) === fileState) {
      return false;
    }
    lastFileStates.set(absolutePath, fileState);
    return true;
  };
}

// Stats alone are not enough: Timestamps can be coarse (FAT and some network
// file systems have 1–2 seconds, and Linux uses a clock that only ticks every
// few milliseconds). An in-place write keeps the inode, and might keep the
// size. So if a file is written, then stat:ed, then written again within the
// same tick, the two stats are identical, and we would miss the second edit.
// The contents are the ground truth, so small files are hashed as well. That
// has to happen on _every_ event, since a later duplicate must be compared to
// the contents at the time of the first event (which might be overwritten by
// then), and we can’t know in advance whether a duplicate will come. The hash
// is cheap for .elm files (~0.1 ms for typical sizes). The inode and ctime
// catch changes that keep the size and restore the mtime (like `cp -p`).
//
// Reading happens synchronously on every event, so large files are not hashed:
// The static files directory might contain big images or videos, which are
// often written in chunks (one event per chunk). For those, only the stats are
// used, and only if the file was last modified so long ago that even a coarse
// clock has ticked since then (`RECENT_MODIFICATION_MS`), so any new edit gets
// a different mtime. Duplicates arrive shortly after a write, so in practice
// this means that duplicates for large files are not skipped – which is fine,
// the important thing is to never skip a real change.
//
// Returns `undefined` when the file state can’t be trusted, meaning the event
// is always reported. That’s also the case for directories: Their timestamps
// don’t reflect what happened inside them.
function getFileState(absolutePath: AbsolutePath): string | undefined {
  let stats: fs.BigIntStats;
  let content: Buffer | undefined;
  try {
    stats = fs.statSync(absolutePath, { bigint: true });
    if (stats.isDirectory()) {
      return undefined;
    }
    if (stats.size <= MAX_HASHED_FILE_SIZE) {
      content = fs.readFileSync(absolutePath);
    } else if (Date.now() - Number(stats.mtimeMs) < RECENT_MODIFICATION_MS) {
      return undefined;
    }
  } catch (unknownError) {
    return isMissingError(toError(unknownError)) ? "missing" : undefined;
  }
  return [
    stats.ino,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
    content === undefined
      ? ""
      : crypto.createHash("sha1").update(content).digest("hex"),
  ].join(":");
}

const MAX_HASHED_FILE_SIZE = 1024 * 1024;
const RECENT_MODIFICATION_MS = 3000;

function isMissingError(error: Error): boolean {
  const { code } = error as Error & { code?: unknown };
  return code === "ENOENT" || code === "ENOTDIR";
}
