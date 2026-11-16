import { describe, expect, test } from "vitest";

import { ELM_WATCH_HOST } from "../src/Env.ts";
import { getHostFromEnv, markAsHost, resolveHost } from "../src/Host.ts";

describe("getHostFromEnv", () => {
  test("unset", () => {
    expect(getHostFromEnv({})).toBeUndefined();
  });

  test("empty means unset (instead of listening on all interfaces)", () => {
    expect(getHostFromEnv({ [ELM_WATCH_HOST]: "" })).toBeUndefined();
  });

  test("set", () => {
    expect(getHostFromEnv({ [ELM_WATCH_HOST]: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

describe("resolveHost", () => {
  const configHost = markAsHost("192.168.0.1");

  test("default", () => {
    expect(resolveHost({}, undefined)).toStrictEqual({
      host: "127.0.0.1",
      hostSource: "Default",
    });
  });

  test("config", () => {
    expect(resolveHost({}, configHost)).toStrictEqual({
      host: "192.168.0.1",
      hostSource: "Config",
    });
  });

  test("env takes precedence", () => {
    expect(
      resolveHost({ [ELM_WATCH_HOST]: "0.0.0.0" }, configHost),
    ).toStrictEqual({ host: "0.0.0.0", hostSource: "Env" });
  });

  test("empty env is ignored", () => {
    expect(resolveHost({ [ELM_WATCH_HOST]: "" }, configHost)).toStrictEqual({
      host: "192.168.0.1",
      hostSource: "Config",
    });
  });
});
