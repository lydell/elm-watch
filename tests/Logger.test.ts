import { describe, expect, test } from "vitest";

import { makeLogger } from "../src/Logger.ts";
import { MemoryWriteStream, SilentReadStream } from "./Helpers.ts";

function setup(
  stdin: SilentReadStream,
  env: Record<string, string> = {},
): {
  logger: ReturnType<typeof makeLogger>;
  exits: Array<string>;
  keys: Array<string>;
} {
  const logger = makeLogger({
    env,
    getNow: () => new Date(),
    stdin,
    stdout: new MemoryWriteStream(),
    stderr: new MemoryWriteStream(),
    logDebug: () => {
      // Do nothing.
    },
  });
  const exits: Array<string> = [];
  const keys: Array<string> = [];
  logger.setRawMode(
    () => {
      exits.push("exit");
    },
    (data) => {
      keys.push(data);
    },
  );
  return { logger, exits, keys };
}

describe("Logger", () => {
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
    const { logger, exits, keys } = setup(stdin);
    stdin.emit("data", Buffer.from("l"));
    stdin.emit("data", Buffer.from("\x03"));
    expect(keys).toStrictEqual(["l"]);
    expect(exits).toStrictEqual(["exit"]);
    logger.reset();
    // Left enabled, since elm-watch didn’t enable it.
    expect(stdin.isRaw).toBe(true);
  });

  test("stdin already flowing", () => {
    const stdin = new SilentReadStream();
    stdin.on("data", () => {
      // The caller’s own listener.
    });
    expect(stdin.readableFlowing).toBe(true);
    const { logger } = setup(stdin);
    logger.reset();
    // Left flowing, since elm-watch didn’t start it.
    expect(stdin.readableFlowing).toBe(true);
  });

  test("raw mode enabled by elm-watch is disabled on reset", () => {
    const stdin = new SilentReadStream();
    const { logger } = setup(stdin);
    expect(stdin.isRaw).toBe(true);
    expect(stdin.readableFlowing).toBe(true);
    logger.reset();
    expect(stdin.isRaw).toBe(false);
    expect(stdin.readableFlowing).toBe(false);
  });

  test("raw mode enabled by someone else does not count as reading keypresses", () => {
    const stdin = new SilentReadStream();
    stdin.isRaw = true;
    const logger = makeLogger({
      env: {},
      getNow: () => new Date(),
      stdin,
      stdout: new MemoryWriteStream(),
      stderr: new MemoryWriteStream(),
      logDebug: () => {
        // Do nothing.
      },
    });
    expect(logger.isRawMode()).toBe(false);
    logger.setRawMode(() => {
      // Do nothing.
    });
    expect(logger.isRawMode()).toBe(true);
    logger.reset();
    expect(logger.isRawMode()).toBe(false);
  });

  test("no raw mode with __ELM_WATCH_NOT_TTY", () => {
    const stdin = new SilentReadStream();
    const { logger } = setup(stdin, { __ELM_WATCH_NOT_TTY: "" });
    expect(stdin.isRaw).toBe(false);
    expect(logger.isRawMode()).toBe(false);
  });
});
