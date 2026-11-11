import * as Codec from "tiny-decoders";

import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";

// Errors from outside elm-watch, such as from esbuild or code generation in
// the user’s elm-watch.mjs. They are reported with `createErrorReporter()`
// (see index.d.ts), and shown just like Elm’s errors, in the terminal and in
// the browser. elm-watch owns the terminal, so the user can’t print errors
// there themselves.

export type ExternalError = Codec.Infer<typeof ExternalError>;
const ExternalError = Codec.fields(
  {
    message: Codec.string,
    location: Codec.field(
      Codec.undefinedOr(
        Codec.fields(
          {
            file: Codec.string,
            line: Codec.field(Codec.undefinedOr(Codec.number), {
              optional: true,
            }),
            column: Codec.field(Codec.undefinedOr(Codec.number), {
              optional: true,
            }),
          },
          { allowExtraFields: true },
        ),
      ),
      { optional: true },
    ),
  },
  // For example, esbuild’s messages can be passed as-is.
  { allowExtraFields: true },
);

const ExternalErrors = Codec.array(ExternalError);

export type ExternalErrorsSnapshot = {
  // Increased on every change.
  version: number;
  // In the order the sources got their errors.
  sources: Array<[source: string, errors: NonEmptyArray<ExternalError>]>;
};

type State = {
  version: number;
  sources: Map<string, NonEmptyArray<ExternalError>>;
  // The target names of the elm-watch that uses the reporter. Sources must not
  // have the same name as a target, since they are shown in the same list.
  targetNames: Set<string>;
  listeners: Set<(source: string, numErrors: number) => void>;
};

export type ErrorReporter = {
  set: (source: string, errors: Array<ExternalError>) => void;
};

// The state is kept outside the reporter object, so that only `set` is public.
const states = new WeakMap<ErrorReporter, State>();

export function createErrorReporter(): ErrorReporter {
  const state: State = {
    version: 0,
    sources: new Map(),
    targetNames: new Set(),
    listeners: new Set(),
  };

  const reporter: ErrorReporter = Object.freeze({
    set: (source: unknown, errors: unknown): void => {
      if (typeof source !== "string" || !/^[^\p{Cc}]+$/u.test(source)) {
        throw new TypeError(
          `ErrorReporter#set: Expected the source to be a non-empty, single line string, but got: ${Codec.repr(source)}`,
        );
      }
      if (state.targetNames.has(source)) {
        throw new TypeError(
          `ErrorReporter#set: The source must not have the same name as a target, but got: ${Codec.repr(source)}`,
        );
      }
      const result = ExternalErrors.decoder(errors);
      if (result.tag === "DecoderError") {
        throw new TypeError(
          `ErrorReporter#set: Invalid errors for ${Codec.repr(source)}:\n\n${Codec.format(result.error)}`,
        );
      }
      // Copy, so that mutating the passed objects later doesn’t affect us.
      const newErrors = result.value.map(
        ({ message, location }): ExternalError => ({
          message,
          location:
            location === undefined
              ? undefined
              : {
                  file: location.file,
                  line: location.line,
                  column: location.column,
                },
        }),
      );
      const previous = state.sources.get(source);
      if (
        Codec.JSON.stringify(ExternalErrors, previous ?? []) ===
        Codec.JSON.stringify(ExternalErrors, newErrors)
      ) {
        return;
      }
      if (isNonEmptyArray(newErrors)) {
        state.sources.set(source, newErrors);
      } else {
        state.sources.delete(source);
      }
      state.version++;
      for (const listener of state.listeners) {
        listener(source, newErrors.length);
      }
    },
  });

  states.set(reporter, state);
  return reporter;
}

export function isErrorReporter(value: unknown): value is ErrorReporter {
  return (
    typeof value === "object" &&
    value !== null &&
    states.has(value as ErrorReporter)
  );
}

function getState(reporter: ErrorReporter): State {
  const state = states.get(reporter);
  if (state === undefined) {
    throw new Error("ExternalErrors: Unknown ErrorReporter.");
  }
  return state;
}

// Called when elm-watch starts using the reporter. Returns the sources that
// have the same name as a target, if any.
export function setTargetNames(
  reporter: ErrorReporter,
  targetNames: Array<string>,
): Array<string> {
  const state = getState(reporter);
  state.targetNames = new Set(targetNames);
  return Array.from(state.sources.keys()).filter((source) =>
    state.targetNames.has(source),
  );
}

export function getSnapshot(
  reporter: ErrorReporter | undefined,
): ExternalErrorsSnapshot {
  if (reporter === undefined) {
    return EMPTY_SNAPSHOT;
  }
  const state = getState(reporter);
  return { version: state.version, sources: Array.from(state.sources) };
}

export const EMPTY_SNAPSHOT: ExternalErrorsSnapshot = {
  version: 0,
  sources: [],
};

export function subscribe(
  reporter: ErrorReporter,
  listener: (source: string, numErrors: number) => void,
): () => void {
  const { listeners } = getState(reporter);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
