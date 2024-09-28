export async function runTeaProgram<Mutable, Msg, Model, Cmd, Result>(options: {
  initMutable: (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: Result) => void,
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
    let killed = false;

    const dispatch = (dispatchedMsg: Msg): void => {
      /* v8 ignore start */
      if (killed) {
        return;
      }
      /* v8 ignore stop */
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
        options.runCmd(
          cmd,
          mutable,
          dispatch,
          (result) => {
            cmds.length = 0;
            killed = true;
            resolve(result);
          },
          /* v8 ignore start */
          (error) => {
            cmds.length = 0;
            killed = true;
            reject(error);
          }
          /* v8 ignore stop */
        );
        /* v8 ignore start */
        if (killed) {
          break;
        }
        /* v8 ignore stop */
      }
    };

    const mutable = options.initMutable(
      dispatch,
      (result) => {
        killed = true;
        resolve(result);
      },
      /* v8 ignore start */
      (error) => {
        killed = true;
        reject(error);
      }
      /* v8 ignore stop */
    );

    runCmds(initialCmds);
  });
}
