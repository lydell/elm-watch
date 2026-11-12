import { describe, expect, test } from "vitest";

import { BEGIN_SYNC_UPDATE, END_SYNC_UPDATE } from "../src/Helpers.ts";
import { type Terminal, makeTerminal } from "../src/Terminal.ts";
import { MemoryWriteStream, SilentReadStream } from "./Helpers.ts";

function makeTestTerminal({
  env = {},
  stdin = new SilentReadStream(),
  stdout = new MemoryWriteStream(),
  stderr = new MemoryWriteStream(),
}: {
  env?: Record<string, string>;
  stdin?: SilentReadStream;
  stdout?: MemoryWriteStream;
  stderr?: MemoryWriteStream;
}): Terminal {
  return makeTerminal({
    env,
    getNow: () => new Date(),
    stdin,
    stdout,
    stderr,
    logDebug: () => {
      // Do nothing.
    },
  });
}

// `MemoryWriteStream` removes some escapes. This keeps everything.
function captureRawWrites(stdout: MemoryWriteStream): { raw: string } {
  const result = { raw: "" };
  stdout.write = (chunk: string): boolean => {
    result.raw += chunk;
    return true;
  };
  return result;
}

function setup(
  stdin: SilentReadStream,
  env: Record<string, string> = {},
): {
  terminal: Terminal;
  exits: Array<string>;
  keys: Array<string>;
} {
  const terminal = makeTestTerminal({ env, stdin });
  const exits: Array<string> = [];
  const keys: Array<string> = [];
  terminal.setRawMode(
    () => {
      exits.push("exit");
    },
    (data) => {
      keys.push(data);
    },
  );
  return { terminal, exits, keys };
}

describe("Terminal", () => {
  test("ctrl+c together with other keys", () => {
    const stdin = new SilentReadStream();
    const { exits, keys } = setup(stdin);
    stdin.emit("data", Buffer.from("l"));
    stdin.emit("data", Buffer.from("l\x03"));
    expect(exits).toStrictEqual(["exit"]);
    expect(keys).toStrictEqual(["l"]);
  });

  test("raw mode already enabled", () => {
    const stdin = new SilentReadStream();
    stdin.isRaw = true;
    const { terminal, exits, keys } = setup(stdin);
    stdin.emit("data", Buffer.from("l"));
    stdin.emit("data", Buffer.from("\x03"));
    expect(keys).toStrictEqual(["l"]);
    expect(exits).toStrictEqual(["exit"]);
    terminal.reset();
    // Left enabled, since elm-watch didn’t enable it.
    expect(stdin.isRaw).toBe(true);
  });

  test("stdin already flowing", () => {
    const stdin = new SilentReadStream();
    stdin.on("data", () => {
      // The caller’s own listener.
    });
    expect(stdin.readableFlowing).toBe(true);
    const { terminal } = setup(stdin);
    terminal.reset();
    // Left flowing, since elm-watch didn’t start it.
    expect(stdin.readableFlowing).toBe(true);
  });

  test("raw mode enabled by elm-watch is disabled on reset", () => {
    const stdin = new SilentReadStream();
    const { terminal } = setup(stdin);
    expect(stdin.isRaw).toBe(true);
    expect(stdin.readableFlowing).toBe(true);
    terminal.reset();
    expect(stdin.isRaw).toBe(false);
    expect(stdin.readableFlowing).toBe(false);
  });

  test("raw mode enabled by someone else does not count as reading keypresses", () => {
    const stdin = new SilentReadStream();
    stdin.isRaw = true;
    const terminal = makeTestTerminal({ stdin });
    expect(terminal.isRawMode()).toBe(false);
    terminal.setRawMode(() => {
      // Do nothing.
    });
    expect(terminal.isRawMode()).toBe(true);
    terminal.reset();
    expect(terminal.isRawMode()).toBe(false);
  });

  test("no raw mode with __ELM_WATCH_NOT_TTY", () => {
    const stdin = new SilentReadStream();
    const { terminal } = setup(stdin, { __ELM_WATCH_NOT_TTY: "" });
    expect(stdin.isRaw).toBe(false);
    expect(terminal.isRawMode()).toBe(false);
  });

  test("no terminal query when stdout is not a TTY", async () => {
    const stdin = new SilentReadStream();
    stdin.isRaw = true;
    const stdout = new MemoryWriteStream();
    stdout.isTTY = false;
    const terminal = makeTestTerminal({ stdin, stdout });
    expect(await terminal.queryTerminal("\x1B]11;?\x07", () => true)).toBe(
      undefined,
    );
    expect(stdout.content).toBe("");
  });

  describe("queryTerminal", () => {
    function setupQuery(): {
      terminal: Terminal;
      stdin: SilentReadStream;
      query: (escapes: string) => Promise<string | undefined>;
    } {
      const stdin = new SilentReadStream();
      stdin.isRaw = true;
      const terminal = makeTestTerminal({ stdin });
      const query = (escapes: string): Promise<string | undefined> =>
        terminal.queryTerminal(escapes, (response) => response.endsWith("!"));
      return { terminal, stdin, query };
    }

    test("results are cached per escapes", async () => {
      const { stdin, query } = setupQuery();

      const a1 = query("a");
      stdin.emit("data", Buffer.from("A!"));
      expect(await a1).toBe("A!");

      const b = query("b");
      stdin.emit("data", Buffer.from("B!"));
      expect(await b).toBe("B!");

      // Cached, so no need to respond.
      expect(await query("a")).toBe("A!");
    });

    test("concurrent queries with the same escapes share the response", async () => {
      const { stdin, query } = setupQuery();
      const first = query("a");
      const second = query("a");
      stdin.emit("data", Buffer.from("A!"));
      expect(await first).toBe("A!");
      expect(await second).toBe("A!");
    });

    test("a query finishing after reset is not cached", async () => {
      const { terminal, stdin, query } = setupQuery();
      const stale = query("a");
      terminal.reset();
      stdin.emit("data", Buffer.from("old!"));
      expect(await stale).toBe("old!");

      const fresh = query("a");
      stdin.emit("data", Buffer.from("new!"));
      expect(await fresh).toBe("new!");
    });
  });

  test("nested withSynchronizedOutput", () => {
    const stdout = new MemoryWriteStream();
    const written = captureRawWrites(stdout);
    const terminal = makeTestTerminal({ stdout });
    terminal.withSynchronizedOutput(() => {
      terminal.write("a");
      terminal.withSynchronizedOutput(() => {
        terminal.write("b");
      });
      terminal.write("c");
    });
    expect(written.raw).toBe(`${BEGIN_SYNC_UPDATE}a\nb\nc\n${END_SYNC_UPDATE}`);
  });

  test("stderr after writeWithoutTrailingNewline ends the stdout line", () => {
    const stdout = new MemoryWriteStream();
    const stderr = new MemoryWriteStream();
    const terminal = makeTestTerminal({ stdout, stderr });
    terminal.writeWithoutTrailingNewline("a");
    terminal.writeToStderrMakesALotOfSenseHere("b");
    terminal.write("c");
    expect(stdout.content).toBe("a\nc\n");
    expect(stderr.content).toBe("b\n");
  });

  test("clearLastLines(0) does nothing", () => {
    const stdout = new MemoryWriteStream();
    const written = captureRawWrites(stdout);
    const terminal = makeTestTerminal({ stdout });
    terminal.writeWithoutTrailingNewline("a");
    written.raw = "";
    terminal.clearLastLines(0);
    expect(written.raw).toBe("");
  });
});
