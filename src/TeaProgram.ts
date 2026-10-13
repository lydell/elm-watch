import { toError } from "./Helpers";

export async function runTeaProgram<Mutable, Msg, Model, Cmd, Result>(options: {
  initMutable: (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: Result) => void,
    rejectPromise: (error: Error) => void,
  ) => Mutable;
  init: [Model, Array<Cmd>];
  update: (msg: Msg, model: Model) => [Model, Array<Cmd>];
  runCmd: (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: Result) => void,
    rejectPromise: (error: Error) => void,
  ) => void;
}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const [initialModel, initialCmds] = options.init;
    let model: Model = initialModel;
    const msgQueue: Array<Msg> = [];
    let killed = false;
    // Messages dispatched while running are queued, and handled in order once
    // the current work is done. This starts out as `true`, since `initMutable`
    // might call `dispatch` synchronously, before `mutable` has been assigned,
    // and since the initial commands should all run before any message is
    // handled.
    let running = true;

    const resolveProgram = (result: Result): void => {
      killed = true;
      resolve(result);
    };

    const rejectProgram = (error: Error): void => {
      killed = true;
      reject(error);
    };

    const dispatch = (msg: Msg): void => {
      if (killed) {
        return;
      }
      msgQueue.push(msg);
      if (!running) {
        runMsgQueue();
      }
    };

    const runMsgQueue = (): void => {
      running = true;
      try {
        for (const msg of msgQueue) {
          if (killed) {
            break;
          }
          const [newModel, cmds] = options.update(msg, model);
          model = newModel;
          runCmds(cmds);
        }
      } catch (error) {
        rejectProgram(toError(error));
      } finally {
        // Always reset, so that the program can’t get stuck with messages that
        // are never handled.
        msgQueue.length = 0;
        running = false;
      }
    };

    const runCmds = (cmds: Array<Cmd>): void => {
      for (const cmd of cmds) {
        if (killed) {
          break;
        }
        options.runCmd(cmd, mutable, dispatch, resolveProgram, rejectProgram);
      }
    };

    const mutable = options.initMutable(
      dispatch,
      resolveProgram,
      rejectProgram,
    );

    try {
      runCmds(initialCmds);
    } catch (error) {
      rejectProgram(toError(error));
    }

    runMsgQueue();
  });
}
