import { describe, expect, test } from "vitest";

import { runTeaProgram } from "../src/TeaProgram";

// `Log` commands write to `mutable.events`, which also verifies that `runCmd`
// is given the `mutable` returned by `initMutable`.
type Mutable = {
  events: Array<string>;
};

type Model = {
  count: number;
};

type Msg =
  | {
      tag: "Increment";
    }
  | {
      tag: "RunCmds";
      cmds: Array<Cmd>;
    };

type Cmd =
  | {
      tag: "Dispatch";
      msg: Msg;
    }
  | {
      tag: "Log";
      message: string;
    }
  | {
      tag: "Reject";
      error: Error;
    }
  | {
      tag: "Resolve";
      result: Result;
    };

type Result = string;

type Callbacks = {
  dispatch: (msg: Msg) => void;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
};

function runProgram({
  initCmds,
  onInitMutable,
}: {
  initCmds: Array<Cmd>;
  onInitMutable?: (callbacks: Callbacks) => void;
}): {
  promise: Promise<Result>;
  events: Array<string>;
  // Lets tests dispatch, resolve and reject from the outside, after
  // `runTeaProgram` has started (like events from the outside world would).
  callbacks: Callbacks;
} {
  const mutable: Mutable = { events: [] };
  const notStarted = (): never => {
    throw new Error("runTeaProgram has not started");
  };
  const callbacks: Callbacks = {
    dispatch: notStarted,
    resolve: notStarted,
    reject: notStarted,
  };

  const promise = runTeaProgram<Mutable, Msg, Model, Cmd, Result>({
    initMutable: (dispatch, resolvePromise, rejectPromise) => {
      callbacks.dispatch = dispatch;
      callbacks.resolve = resolvePromise;
      callbacks.reject = rejectPromise;
      onInitMutable?.(callbacks);
      return mutable;
    },
    init: [{ count: 0 }, initCmds],
    update: (msg, model) => {
      mutable.events.push(`update ${msg.tag}`);
      switch (msg.tag) {
        case "Increment": {
          const count = model.count + 1;
          return [{ count }, [{ tag: "Log", message: `count ${count}` }]];
        }
        case "RunCmds":
          return [model, msg.cmds];
      }
    },
    runCmd: (cmd, mutableArg, dispatch, resolvePromise, rejectPromise) => {
      switch (cmd.tag) {
        case "Dispatch":
          dispatch(cmd.msg);
          return;
        case "Log":
          mutableArg.events.push(cmd.message);
          return;
        case "Reject":
          rejectPromise(cmd.error);
          return;
        case "Resolve":
          resolvePromise(cmd.result);
          return;
      }
    },
  });

  return { promise, events: mutable.events, callbacks };
}

describe("runTeaProgram", () => {
  test("runs initial commands, then updates the model and runs commands for each message", async () => {
    const { promise, events, callbacks } = runProgram({
      initCmds: [
        { tag: "Log", message: "init 1" },
        { tag: "Log", message: "init 2" },
      ],
    });

    callbacks.dispatch({ tag: "Increment" });
    callbacks.dispatch({ tag: "Increment" });
    callbacks.dispatch({
      tag: "RunCmds",
      cmds: [
        { tag: "Log", message: "a" },
        { tag: "Log", message: "b" },
        { tag: "Resolve", result: "Done" },
      ],
    });

    await expect(promise).resolves.toBe("Done");
    expect(events).toStrictEqual([
      "init 1",
      "init 2",
      "update Increment",
      "count 1",
      "update Increment",
      "count 2",
      "update RunCmds",
      "a",
      "b",
    ]);
  });

  test("messages dispatched while handling a message are handled after all its commands", async () => {
    const { promise, events, callbacks } = runProgram({ initCmds: [] });

    callbacks.dispatch({
      tag: "RunCmds",
      cmds: [
        {
          tag: "Dispatch",
          msg: {
            tag: "RunCmds",
            cmds: [
              { tag: "Log", message: "b" },
              {
                tag: "Dispatch",
                msg: {
                  tag: "RunCmds",
                  cmds: [{ tag: "Resolve", result: "Done" }],
                },
              },
            ],
          },
        },
        { tag: "Dispatch", msg: { tag: "Increment" } },
        { tag: "Log", message: "a" },
      ],
    });

    await expect(promise).resolves.toBe("Done");
    expect(events).toStrictEqual([
      "update RunCmds",
      "a",
      "update RunCmds",
      "b",
      "update Increment",
      "count 1",
      "update RunCmds",
    ]);
  });

  // Regression test for: ReferenceError: Cannot access 'mutable' before initialization
  test("messages dispatched during initMutable are handled after the initial commands", async () => {
    const { promise, events } = runProgram({
      initCmds: [{ tag: "Log", message: "init" }],
      onInitMutable: (callbacks) => {
        callbacks.dispatch({ tag: "Increment" });
        callbacks.dispatch({ tag: "Increment" });
        callbacks.dispatch({
          tag: "RunCmds",
          cmds: [{ tag: "Resolve", result: "Done" }],
        });
      },
    });

    await expect(promise).resolves.toBe("Done");
    expect(events).toStrictEqual([
      "init",
      "update Increment",
      "count 1",
      "update Increment",
      "count 2",
      "update RunCmds",
    ]);
  });

  test("stop running commands and processing messages after resolve in initial command", async () => {
    const { promise, events, callbacks } = runProgram({
      initCmds: [
        { tag: "Log", message: "init" },
        { tag: "Resolve", result: "Done" },
        { tag: "Log", message: "after init" },
      ],
      onInitMutable: ({ dispatch }) => {
        dispatch({ tag: "Increment" });
      },
    });

    await expect(promise).resolves.toBe("Done");

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual(["init"]);
  });

  test("stop running commands and processing messages after reject in initial command", async () => {
    const error = new Error("Stopped");
    const { promise, events, callbacks } = runProgram({
      initCmds: [
        { tag: "Log", message: "init" },
        { tag: "Reject", error },
        { tag: "Log", message: "after init" },
      ],
      onInitMutable: ({ dispatch }) => {
        dispatch({ tag: "Increment" });
      },
    });

    await expect(promise).rejects.toBe(error);

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual(["init"]);
  });

  test("stop running commands and processing messages after resolve in queued message", async () => {
    const { promise, events, callbacks } = runProgram({
      initCmds: [
        { tag: "Log", message: "init" },
        { tag: "Log", message: "after init" },
      ],
      onInitMutable: ({ dispatch }) => {
        dispatch({
          tag: "RunCmds",
          cmds: [
            { tag: "Log", message: "finish" },
            { tag: "Resolve", result: "Done" },
            { tag: "Log", message: "after finish" },
          ],
        });
        dispatch({ tag: "Increment" });
      },
    });

    await expect(promise).resolves.toBe("Done");

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual([
      "init",
      "after init",
      "update RunCmds",
      "finish",
    ]);
  });

  test("stop running commands and processing messages after reject in queued message", async () => {
    const error = new Error("Stopped");
    const { promise, events, callbacks } = runProgram({
      initCmds: [
        { tag: "Log", message: "init" },
        { tag: "Log", message: "after init" },
      ],
      onInitMutable: ({ dispatch }) => {
        dispatch({
          tag: "RunCmds",
          cmds: [
            { tag: "Log", message: "finish" },
            { tag: "Reject", error },
            { tag: "Log", message: "after finish" },
          ],
        });
        dispatch({ tag: "Increment" });
      },
    });

    await expect(promise).rejects.toBe(error);

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual([
      "init",
      "after init",
      "update RunCmds",
      "finish",
    ]);
  });

  test("resolve from initMutable", async () => {
    const { promise, events, callbacks } = runProgram({ initCmds: [] });

    callbacks.dispatch({ tag: "Increment" });
    callbacks.resolve("Done");
    await expect(promise).resolves.toBe("Done");

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual(["update Increment", "count 1"]);
  });

  test("reject from initMutable", async () => {
    const error = new Error("Stopped");
    const { promise, events, callbacks } = runProgram({ initCmds: [] });

    callbacks.dispatch({ tag: "Increment" });
    callbacks.reject(error);
    await expect(promise).rejects.toBe(error);

    // Dispatching after the program has finished does nothing.
    callbacks.dispatch({ tag: "Increment" });

    expect(events).toStrictEqual(["update Increment", "count 1"]);
  });
});
