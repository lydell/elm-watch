export async function runTeaProgram<Mutable, Msg, Model, Cmd, Result>(options: {
  initMutable: (
    dispatch: (msg: Msg) => void,
    reject: (error: Error) => void
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
    let runningCmds = true;

    const dispatch = (msg: Msg): void => {
      if (runningCmds) {
        reject(
          new Error(
            `\`dispatch\` must not be called synchronously. Dispatched msg: ${JSON.stringify(
              msg
            )}`
          )
        );
        return;
      }
      const [newModel, cmds] = options.update(msg, model);
      model = newModel;
      runCmds(cmds);
    };

    const runCmds = (cmds: Array<Cmd>): void => {
      runningCmds = true;
      for (const cmd of cmds) {
        options.runCmd(cmd, mutable, dispatch, resolve, reject);
      }
      runningCmds = false;
    };

    const mutable = options.initMutable(dispatch, reject);

    runCmds(initialCmds);
  });
}
