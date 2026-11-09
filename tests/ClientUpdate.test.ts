import { describe, expect, test } from "vitest";

import { retryWaitMs, SEND_KEY_DO_NOT_USE_ALL_THE_TIME } from "../client/Ui.ts";
import {
  type Cmd,
  init,
  type Model,
  type Msg,
  update,
  type UpdateConfig,
} from "../client/Update.ts";
import type { WebSocketToClientMessage } from "../client/WebSocketMessages.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// The client is a TEA program: `update` is pure, and all side effects happen in
// `runCmd` in client.ts. These tests feed messages directly to `update`, which
// makes it possible to test things like reconnecting and focusing while
// connecting deterministically. The integration tests in HotConnect.test.ts
// depend on timing.

class Simulation {
  private model: Model;

  private now = 0;

  private readonly transcript: Array<string> = [];

  private readonly config: UpdateConfig;

  constructor(config: Partial<UpdateConfig> = {}) {
    this.config = {
      originalCompilationMode: "standard",
      initialElmCompiledTimestamp: 1,
      ...config,
    };
    const [model, cmds] = init(this.config, this.date(), undefined);
    this.model = model;
    this.log("init", cmds);
  }

  wait(ms: number): this {
    this.now += ms;
    this.transcript.push(`(${ms} ms later)`);
    return this;
  }

  send(makeMsg: (date: Date) => Msg): this {
    const msg = makeMsg(this.date());
    const [model, cmds] = update(this.config, msg, this.model);
    this.model = model;
    this.log(describeMsg(msg), cmds);
    return this;
  }

  receive(message: WebSocketToClientMessage): this {
    return this.send((date) => ({
      tag: "WebSocketMessageReceived",
      date,
      data: JSON.stringify(message),
    }));
  }

  toString(): string {
    return this.transcript.join("\n\n");
  }

  private date(): Date {
    return new Date(this.now);
  }

  private log(what: string, cmds: Array<Cmd>): void {
    this.transcript.push(
      [
        `> ${what}`,
        `  ${describeModel(this.model)}`,
        ...cmds
          .filter((cmd) => cmd.tag !== "NoCmd" && cmd.tag !== "Render")
          .map((cmd) => `  cmd: ${describeCmd(cmd)}`),
      ].join("\n"),
    );
  }
}

function describeMsg(msg: Msg): string {
  switch (msg.tag) {
    case "UiMsg":
      return `${msg.tag} ${msg.msg.tag}`;
    case "WebSocketMessageReceived": {
      const data = typeof msg.data === "string" ? msg.data : "";
      const tag = /"tag":"(\w+)"/.exec(data)?.[1] ?? data;
      const status = /"status":\{"tag":"(\w+)"/.exec(data)?.[1];
      return `${msg.tag} ${tag}${status === undefined ? "" : ` ${status}`}`;
    }
    default:
      return msg.tag;
  }
}

function describeModel(model: Model): string {
  const { status } = model;
  const details = [
    `status: ${status.tag}`,
    ...("attemptNumber" in status ? [`attempt ${status.attemptNumber}`] : []),
    ...("errors" in status && status.errors !== undefined
      ? [`${status.errors.size} errors`]
      : []),
    ...("reasons" in status
      ? status.reasons.map((reason) => `reason: ${reason}`)
      : []),
    `mode: ${model.compilationMode}`,
    `timestamp: ${model.elmCompiledTimestamp}`,
  ];
  return details.join(", ");
}

function describeCmd(cmd: Cmd): string {
  switch (cmd.tag) {
    case "SendMessage":
      return `${cmd.tag} ${cmd.message.tag}`;
    case "SleepBeforeReconnect":
      return `${cmd.tag} (attempt ${cmd.attemptNumber}, ${retryWaitMs(cmd.attemptNumber)} ms)`;
    case "Reconnect":
      return `${cmd.tag} (timestamp ${cmd.elmCompiledTimestamp})`;
    case "TriggerReachedIdleState":
      return `${cmd.tag} ${cmd.reason}`;
    case "Eval":
      return `${cmd.tag} ${cmd.code}`;
    default:
      return cmd.tag;
  }
}

const msg = {
  connected: (date: Date): Msg => ({ tag: "WebSocketConnected", date }),
  closed: (date: Date): Msg => ({ tag: "WebSocketClosed", date }),
  sleepDone: (date: Date): Msg => ({ tag: "SleepBeforeReconnectDone", date }),
  focused: (): Msg => ({ tag: "FocusedTab" }),
  visible: (date: Date): Msg => ({
    tag: "PageVisibilityChangedToVisible",
    date,
  }),
  reconnectNow: (date: Date): Msg => ({
    tag: "UiMsg",
    date,
    msg: { tag: "PressedReconnectNow" },
  }),
  changeCompilationMode: (date: Date): Msg => ({
    tag: "UiMsg",
    date,
    msg: {
      tag: "ChangedCompilationMode",
      compilationMode: "optimize",
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
  }),
  evalSucceeded: (date: Date): Msg => ({ tag: "EvalSucceeded", date }),
};

const upToDate: WebSocketToClientMessage = {
  tag: "StatusChanged",
  status: { tag: "AlreadyUpToDate", compilationMode: "standard" },
};

const compileError: WebSocketToClientMessage = {
  tag: "StatusChanged",
  status: {
    tag: "CompileError",
    compilationMode: "standard",
    errors: [
      {
        title: "TYPE MISMATCH",
        htmlContent: "Oops",
      },
    ],
    foregroundColor: "white",
    backgroundColor: "black",
  },
};

describe("client update", () => {
  test("connect", () => {
    expect(new Simulation().send(msg.connected).receive(upToDate).toString())
      .toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived StatusChanged AlreadyUpToDate
        status: Idle, mode: standard, timestamp: 1
        cmd: TriggerReachedIdleState AlreadyUpToDate
    `);
  });

  test("reconnect with increasing waits", () => {
    expect(
      new Simulation()
        .send(msg.closed)
        // Both "error" and "close" happen: Only start reconnecting once.
        .send(msg.closed)
        // The timeout from a previous sleep: Not enough time has passed.
        .wait(retryWaitMs(2) - 1)
        .send(msg.sleepDone)
        .wait(1)
        .send(msg.sleepDone)
        .send(msg.closed)
        .wait(retryWaitMs(3))
        .send(msg.sleepDone)
        .send(msg.connected)
        .receive(upToDate)
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1
        cmd: SleepBeforeReconnect (attempt 2, 1040 ms)

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1

      (1039 ms later)

      > SleepBeforeReconnectDone
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1

      (1 ms later)

      > SleepBeforeReconnectDone
        status: Connecting, attempt 2, mode: standard, timestamp: 1
        cmd: Reconnect (timestamp 1)

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 3, mode: standard, timestamp: 1
        cmd: SleepBeforeReconnect (attempt 3, 1090 ms)

      (1090 ms later)

      > SleepBeforeReconnectDone
        status: Connecting, attempt 3, mode: standard, timestamp: 1
        cmd: Reconnect (timestamp 1)

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived StatusChanged AlreadyUpToDate
        status: Idle, mode: standard, timestamp: 1
        cmd: TriggerReachedIdleState AlreadyUpToDate
    `);
  });

  test("reconnect now, and when the page becomes visible", () => {
    expect(
      new Simulation()
        .send(msg.closed)
        .send(msg.reconnectNow)
        .send(msg.closed)
        .send(msg.visible)
        // Only reconnects when sleeping.
        .send(msg.visible)
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1
        cmd: SleepBeforeReconnect (attempt 2, 1040 ms)

      > UiMsg PressedReconnectNow
        status: Connecting, attempt 2, mode: standard, timestamp: 1
        cmd: Reconnect (timestamp 1)

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 3, mode: standard, timestamp: 1
        cmd: SleepBeforeReconnect (attempt 3, 1090 ms)

      > PageVisibilityChangedToVisible
        status: Connecting, attempt 3, mode: standard, timestamp: 1
        cmd: Reconnect (timestamp 1)

      > PageVisibilityChangedToVisible
        status: Connecting, attempt 3, mode: standard, timestamp: 1
    `);
  });

  // Mirrors “focus while connecting does not close the new connection” in
  // HotConnect.test.ts.
  test("focus only sends a message when connected", () => {
    expect(
      new Simulation()
        .send(msg.focused)
        .send(msg.closed)
        .send(msg.focused)
        .send(msg.sleepDone)
        .wait(retryWaitMs(2))
        .send(msg.sleepDone)
        .send(msg.connected)
        .send(msg.focused)
        .receive({ tag: "FocusedTabAcknowledged" })
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > FocusedTab
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketClosed
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1
        cmd: SleepBeforeReconnect (attempt 2, 1040 ms)

      > FocusedTab
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1

      > SleepBeforeReconnectDone
        status: SleepingBeforeReconnect, attempt 2, mode: standard, timestamp: 1

      (1040 ms later)

      > SleepBeforeReconnectDone
        status: Connecting, attempt 2, mode: standard, timestamp: 1
        cmd: Reconnect (timestamp 1)

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > FocusedTab
        status: Busy, mode: standard, timestamp: 1
        cmd: SendMessage FocusedTab
        cmd: WebSocketTimeoutBegin

      > WebSocketMessageReceived FocusedTabAcknowledged
        status: Busy, mode: standard, timestamp: 1
        cmd: WebSocketTimeoutClear
    `);
  });

  test("successfully compiled", () => {
    expect(
      new Simulation()
        .send(msg.connected)
        .receive({
          tag: "SuccessfullyCompiled",
          code: "/* new code */",
          elmCompiledTimestamp: 2,
          compilationMode: "standard",
        })
        .send(msg.evalSucceeded)
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived SuccessfullyCompiled
        status: Busy, mode: standard, timestamp: 2
        cmd: Eval /* new code */

      > EvalSucceeded
        status: Idle, mode: standard, timestamp: 2
        cmd: TriggerReachedIdleState EvalSucceeded
    `);
  });

  test("compilation mode changed", () => {
    expect(
      new Simulation()
        .send(msg.connected)
        .receive(upToDate)
        .send(msg.changeCompilationMode)
        .receive({
          tag: "SuccessfullyCompiled",
          code: "/* new code */",
          elmCompiledTimestamp: 2,
          compilationMode: "optimize",
        })
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived StatusChanged AlreadyUpToDate
        status: Idle, mode: standard, timestamp: 1
        cmd: TriggerReachedIdleState AlreadyUpToDate

      > UiMsg ChangedCompilationMode
        status: Busy, mode: optimize, timestamp: 1
        cmd: SendMessage ChangedCompilationMode

      > WebSocketMessageReceived SuccessfullyCompiled
        status: WaitingForReload, reason: compilation mode changed from standard to optimize., mode: optimize, timestamp: 1
    `);
  });

  test("proxy files reload without a reason", () => {
    expect(
      new Simulation({ originalCompilationMode: "proxy" })
        .send(msg.connected)
        .receive({
          tag: "SuccessfullyCompiled",
          code: "/* real code */",
          elmCompiledTimestamp: 2,
          compilationMode: "standard",
        })
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: proxy, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: proxy, timestamp: 1

      > WebSocketMessageReceived SuccessfullyCompiled
        status: WaitingForReload, mode: standard, timestamp: 1
    `);
  });

  test("errors are kept while busy", () => {
    expect(
      new Simulation()
        .send(msg.connected)
        .receive(compileError)
        .send(msg.changeCompilationMode)
        .receive({
          tag: "StatusChanged",
          status: { tag: "Busy", compilationMode: "optimize" },
        })
        .receive({
          tag: "StatusChanged",
          status: { tag: "AlreadyUpToDate", compilationMode: "optimize" },
        })
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived StatusChanged CompileError
        status: CompileError, 1 errors, mode: standard, timestamp: 1
        cmd: TriggerReachedIdleState CompileError

      > UiMsg ChangedCompilationMode
        status: Busy, 1 errors, mode: optimize, timestamp: 1
        cmd: SendMessage ChangedCompilationMode

      > WebSocketMessageReceived StatusChanged Busy
        status: Busy, 1 errors, mode: optimize, timestamp: 1

      > WebSocketMessageReceived StatusChanged AlreadyUpToDate
        status: Idle, mode: optimize, timestamp: 1
        cmd: TriggerReachedIdleState AlreadyUpToDate
    `);
  });

  test("bad message from the server", () => {
    expect(
      new Simulation()
        .send(msg.connected)
        .receive({ tag: "Nope" } as unknown as WebSocketToClientMessage)
        .toString(),
    ).toMatchInlineSnapshot(`
      > init
        status: Connecting, attempt 1, mode: standard, timestamp: 1

      > WebSocketConnected
        status: Busy, mode: standard, timestamp: 1

      > WebSocketMessageReceived Nope
        status: UnexpectedError, mode: standard, timestamp: 1
        cmd: OpenPanel
    `);
  });
});
