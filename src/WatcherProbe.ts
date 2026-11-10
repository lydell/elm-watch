import * as fs from "fs";
import * as path from "path";

import type { AbsolutePath } from "./Types.ts";
import type * as Watcher from "./Watcher.ts";

// This is only used in tests, which need to know when it is safe to make file
// changes. On macOS, all `fs.watch` watchers share a single FSEvents stream,
// which libuv recreates on a separate thread every time a watcher is added or
// removed. Events happening before the new stream is up are lost. That usually
// takes less than a millisecond, but can take longer under heavy load. Changes
// made shortly _before_ the stream is created can also be reported late. There
// is no way to know when the stream is up, so we repeatedly write a probe file
// in each watched directory until the watcher has reported all of them. Events
// before that are ignored: They are from before we started watching. Events
// are delivered in order per `fs.watch` watcher, but not across watchers,
// which is why every watched directory needs its own probe.
//
// The same technique lets tests wait until all events for changes they made
// have arrived (`flush`), instead of sleeping.
export type WatcherProbe = {
  // Call after the watchers have been created.
  start: () => void;
  // Resolves once all events for changes made before the call have arrived.
  flush: () => Promise<void>;
  // Returns `true` for events that should not be dispatched.
  ignore: (absolutePath: AbsolutePath) => boolean;
  stop: () => void;
};

type WatcherProbeRound = {
  probePaths: Array<string>;
  pendingProbePaths: Set<string>;
  intervalId: NodeJS.Timeout | undefined;
  onDone: () => void;
  // Whether `onDone` should be called when stopping before done.
  isFlush: boolean;
};

const WATCHER_PROBE_PREFIX = "elm-watch-test-probe-";
const WATCHER_PROBE_INTERVAL_MS = 20;
let watcherProbeCounter = 0;

export function makeWatcherProbe(
  watchDirs: Array<Watcher.WatchDir>,
  onReady: () => void,
): WatcherProbe {
  const rounds = new Set<WatcherProbeRound>();
  let isReady = false;

  const finish = (round: WatcherProbeRound, isDone: boolean): void => {
    rounds.delete(round);
    clearInterval(round.intervalId);
    for (const probePath of round.probePaths) {
      fs.rmSync(probePath, { force: true });
    }
    if (isDone || round.isFlush) {
      round.onDone();
    }
  };

  const write = (round: WatcherProbeRound): void => {
    for (const probePath of round.pendingProbePaths) {
      try {
        fs.writeFileSync(probePath, Date.now().toString());
      } catch {
        // The directory was removed, so there is nothing to wait for there.
        round.pendingProbePaths.delete(probePath);
      }
    }
    if (round.pendingProbePaths.size === 0) {
      finish(round, true);
    }
  };

  const probe = (onDone: () => void, isFlush: boolean): void => {
    watcherProbeCounter++;
    // A new name each time, so that late events from a previous probe aren’t
    // mistaken for this one.
    const probeName = `${WATCHER_PROBE_PREFIX}${watcherProbeCounter}`;
    const probePaths = watchDirs.flatMap(({ dir }) =>
      fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true
        ? [path.join(dir, probeName)]
        : [],
    );
    const round: WatcherProbeRound = {
      probePaths,
      pendingProbePaths: new Set(probePaths),
      intervalId: undefined,
      onDone,
      isFlush,
    };
    rounds.add(round);
    write(round);
    if (rounds.has(round)) {
      round.intervalId = setInterval(() => {
        write(round);
      }, WATCHER_PROBE_INTERVAL_MS);
    }
  };

  return {
    start: () => {
      probe(() => {
        isReady = true;
        onReady();
      }, false);
    },
    flush: async () =>
      new Promise((resolve) => {
        probe(resolve, true);
      }),
    ignore: (absolutePath) => {
      if (path.basename(absolutePath).startsWith(WATCHER_PROBE_PREFIX)) {
        for (const round of rounds) {
          if (round.pendingProbePaths.delete(absolutePath)) {
            if (round.pendingProbePaths.size === 0) {
              finish(round, true);
            }
          }
        }
        return true;
      }
      return !isReady;
    },
    // Pending flushes resolve: No more events will come.
    stop: () => {
      for (const round of rounds) {
        finish(round, false);
      }
    },
  };
}
