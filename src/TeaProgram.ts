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
    // `initMutable` might call `dispatch` synchronously, before `mutable` has
    // been assigned. Queue those messages until `mutable` is ready.
    let initialized = false;

    const dispatch = (dispatchedMsg: Msg): void => {
      if (killed) {
        return;
      }
      const alreadyRunning = msgQueue.length > 0;
      msgQueue.push(dispatchedMsg);
      if (alreadyRunning || !initialized) {
        return;
      }
      runMsgQueue();
    };

    const runMsgQueue = (): void => {
      for (const msg of msgQueue) {
        if (killed) {
          break;
        }
        const [newModel, cmds] = options.update(msg, model);
        model = newModel;
        runCmds(cmds);
      }
      msgQueue.length = 0;
    };

    const runCmds = (cmds: Array<Cmd>): void => {
      for (const cmd of cmds) {
        options.runCmd(
          cmd,
          mutable,
          dispatch,
          (result) => {
            cmds.length = 0;
            killed = true;
            resolve(result);
          },
          (error) => {
            cmds.length = 0;
            killed = true;
            reject(error);
          },
        );
        if (killed) {
          break;
        }
      }
    };

    const mutable = options.initMutable(
      dispatch,
      (result) => {
        killed = true;
        resolve(result);
      },
      (error) => {
        killed = true;
        reject(error);
      },
    );

    initialized = true;
    runCmds(initialCmds);
    runMsgQueue();
  });
}
