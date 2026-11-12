import * as path from "path";

import { ALLOWED_HOSTS_DOCS_LINK, type RejectedHost } from "./AllowedHosts.ts";
import * as Compile from "./Compile.ts";
import type { WebSocketConnectionRejectedReason } from "./DevServer.ts";
import {
  bold,
  dim,
  formatTime,
  quote,
  sanitizeTerminalText,
} from "./Helpers.ts";
import type { LoggerConfig } from "./Logger.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import type { Project } from "./Project.ts";
import type { AbsolutePath, CompilationMode, OutputPath } from "./Types.ts";

// The events that make elm-watch do something (or decide that there is nothing
// to do), and how they are printed.

// We can’t tell whether something was added or changed, since `fs.watch`
// does not reliably say. That also doesn’t matter much.
export type WatcherEventName = "changed" | "removed";

export type WatcherEvent<File = TaggedAbsolutePath | StaticFilesDirPath> = {
  tag: "WatcherEvent";
  eventName: WatcherEventName;
  file: File;
};

export type TaggedAbsolutePath = {
  tag: "AbsolutePath";
  absolutePath: AbsolutePath;
};

type StaticFilesDirPath = {
  tag: "StaticFilesDirPath";
  urlPath: string;
};

export type WebSocketRelatedEvent =
  | {
      tag: "WebSocketChangedCompilationMode";
      outputPath: OutputPath;
      compilationMode: CompilationMode;
    }
  | {
      tag: "WebSocketConnectedNeedingCompilation";
      outputPath: OutputPath;
    }
  | {
      tag: "WebSocketConnectionRejected";
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
    };

type OutputRequestedEvent = {
  tag: "OutputRequestedNeedingCompilation";
  outputPath: OutputPath;
};

// Errors from outside elm-watch were set. See ExternalErrors.ts.
type ExternalErrorsChangedEvent = {
  tag: "ExternalErrorsChanged";
  source: string;
  numErrors: number;
};

export type LatestEvent =
  | ExternalErrorsChangedEvent
  | OutputRequestedEvent
  | WebSocketRelatedEvent
  | (WatcherEvent & { affectsAnyTarget: boolean });

export function makeWatcherEvent(
  eventName: WatcherEventName,
  absolutePath: AbsolutePath,
): WatcherEvent<TaggedAbsolutePath> {
  return {
    tag: "WatcherEvent",
    eventName,
    file: { tag: "AbsolutePath", absolutePath },
  };
}

// Sleep for a little bit to avoid unnecessary recompilation when using “save
// all” in an editor, or when running `git switch some-branch` or `git restore
// .`. These operations results in many files being added/changed/deleted,
// usually with 0-1 ms between each event. This also lets atomic saves finish
// before we check if files exist.
export const WATCHER_EVENT_SLEEP_MS = 10;

export function getLatestEventSleepMs(
  event: LatestEvent,
  webSocketEventSleepMs: number,
): number {
  switch (event.tag) {
    case "WatcherEvent":
      return WATCHER_EVENT_SLEEP_MS;

    // Errors are often set several times in a row (one source after another,
    // or cleared and then set again), so wait a little bit like for files.
    case "ExternalErrorsChanged":
      return WATCHER_EVENT_SLEEP_MS;

    // Also sleep for a little bit when web sockets connect or outputs are
    // requested over HTTP. That’s useful when there are burst connections because of multiple
    // scripts on the same page, or many tabs with elm-watch. This is slower
    // than file system events. Configurable for tests.
    case "OutputRequestedNeedingCompilation":
    case "WebSocketConnectedNeedingCompilation":
    case "WebSocketConnectionRejected":
      return webSocketEventSleepMs;

    // When switching compilation mode, sleep a short amount of time so that
    // the change feels more immediate.
    case "WebSocketChangedCompilationMode":
      return 10;
  }
}

export function filterLatestEvents(
  events: Array<LatestEvent>,
): Array<LatestEvent> {
  // Changes to .elm files that don’t affect anything are only
  // interesting/non-confusing if they happen on their own.
  const filtered = events.filter(
    (event) => !(event.tag === "WatcherEvent" && !event.affectsAnyTarget),
  );
  return isNonEmptyArray(filtered) ? filtered : events;
}

// The time, the message and the latest event on one line.
export function printInfoLine({
  loggerConfig,
  emojiName,
  date,
  message,
  events,
  project,
}: {
  loggerConfig: LoggerConfig;
  emojiName: Compile.EmojiName;
  date: Date;
  message: string;
  events: Array<LatestEvent>;
  project: Project;
}): string {
  const summary = summarizeEvents(
    events,
    project.root,
    project.disabledOutputs.length > 0,
  );
  return printMessageWithTimeAndEmoji({
    loggerConfig,
    emojiName,
    date,
    dateHighlight: bold,
    message: summary === undefined ? message : `${message}   ${dim(summary)}`,
  });
}

export function summarizeEvents(
  events: Array<LatestEvent>,
  root: AbsolutePath,
  hasDisabledTargets: boolean,
): string | undefined {
  const latest = events.at(-1);
  if (latest === undefined) {
    return undefined;
  }
  const more = events.length > 1 ? ` +${events.length - 1} more` : "";
  const what = hasDisabledTargets ? "any enabled target" : "any target";
  return latest.tag === "WatcherEvent" && eventsAreOnlyNotImported(events)
    ? `${printWatcherEventPath(latest, root)}${more} – not imported by ${what}`
    : `${printEventShort(latest, root)}${more}`;
}

function eventsAreOnlyNotImported(events: Array<LatestEvent>): boolean {
  return events.every(
    (event) => event.tag === "WatcherEvent" && !event.affectsAnyTarget,
  );
}

function printWatcherEventPath(
  event: Extract<LatestEvent, { tag: "WatcherEvent" }>,
  root: AbsolutePath,
): string {
  // File names can contain newlines and escape codes, which would mess up the
  // single-line info message.
  return sanitizeTerminalText(
    event.file.tag === "AbsolutePath"
      ? path.relative(root, event.file.absolutePath)
      : event.file.urlPath,
  ).plain.replace(/\s/g, " ");
}

function printEventShort(event: LatestEvent, root: AbsolutePath): string {
  switch (event.tag) {
    case "WatcherEvent":
      return `${event.eventName} ${printWatcherEventPath(event, root)}`;

    case "ExternalErrorsChanged":
      return `${event.source}: ${
        event.numErrors === 0
          ? "no errors"
          : `${event.numErrors} error${event.numErrors === 1 ? "" : "s"}`
      }`;

    case "OutputRequestedNeedingCompilation":
      return `HTTP request: ${event.outputPath.targetName}`;

    case "WebSocketConnectedNeedingCompilation":
      return `web socket connected: ${event.outputPath.targetName}`;

    case "WebSocketConnectionRejected":
      return `rejected web socket from ${
        event.origin === undefined ? "unknown origin" : quote(event.origin)
      }: ${printWebSocketConnectionRejectedReason(event.reason)}`;

    case "WebSocketChangedCompilationMode":
      return `compilation mode ${quote(event.compilationMode)}: ${
        event.outputPath.targetName
      }`;
  }
}

function printMessageWithTimeAndEmoji({
  loggerConfig,
  emojiName,
  date,
  dateHighlight: highlightTime,
  message,
}: {
  loggerConfig: LoggerConfig;
  emojiName: Compile.EmojiName;
  date: Date;
  dateHighlight: (string: string) => string;
  message: string;
}): string {
  const newDate = loggerConfig.mockedTimings
    ? new Date("2022-02-05T13:10:05Z")
    : date;
  return Compile.printStatusLine({
    maxWidth: loggerConfig.columns,
    fancy: loggerConfig.fancy,
    isTTY: loggerConfig.isTTY,
    emojiName,
    string: `${highlightTime(formatTime(newDate))} ${message}`,
  });
}

export function printEventsMessage(events: Array<LatestEvent>): string {
  return eventsAreOnlyNotImported(events) ? "Nothing to do" : "Up to date";
}

function printWebSocketConnectionRejectedReason(
  reason: WebSocketConnectionRejectedReason,
): string {
  switch (reason.tag) {
    case "BadUrl":
      return `wrong URL prefix – ${quote(reason.expectedStart)} != ${quote(reason.actualUrlString.slice(0, reason.expectedStart.length))}`;
    case "HostNotAllowed":
      return printRejectedHost("Host header", reason.rejectedHost);
    case "OriginNotAllowed":
      return printRejectedHost("origin", reason.rejectedHost);
    case "WrongToken":
      return "invalid security token";
  }
}

function printRejectedHost(what: string, rejectedHost: RejectedHost): string {
  switch (rejectedHost.tag) {
    case "NotAllowed":
      return `${what} not allowed – add ${quote(rejectedHost.hostname)} to allowedHosts (see ${ALLOWED_HOSTS_DOCS_LINK})`;
    case "Invalid":
      return `invalid ${what}: ${rejectedHost.value === undefined ? "(missing)" : quote(rejectedHost.value)}`;
  }
}
