export async function runTeaProgram<Mutable, Msg, Model, Cmd, Result>(options: {
  initMutable: (
    dispatch: (msg: Msg) => void,
    rejectPromise: (error: Error) => void
  ) => Mutable;
  init: [Model, Array<Cmd>];
  update: (msg: Msg, model: Model) => [Model, Array<Cmd>];
  runCmd: (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: Result) => void,
    rejectPromise: (error: Error) => void
  ) => void;
}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const [initialModel, initialCmds] = options.init;
    let model: Model = initialModel;
    const msgQueue: Array<Msg> = [];

    const dispatch = (dispatchedMsg: Msg): void => {
      const alreadyRunning = msgQueue.length > 0;
      msgQueue.push(dispatchedMsg);
      if (alreadyRunning) {
        return;
      }
      for (const msg of msgQueue) {
        const [newModel, cmds] = options.update(msg, model);
        model = newModel;
        runCmds(cmds);
      }
      msgQueue.length = 0;
    };

    const runCmds = (cmds: Array<Cmd>): void => {
      for (const cmd of cmds) {
        options.runCmd(cmd, mutable, dispatch, resolve, reject);
      }
    };

    const mutable = options.initMutable(dispatch, reject);

    runCmds(initialCmds);
  });
}
