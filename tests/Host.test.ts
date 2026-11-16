import { describe, expect, test } from "vitest";

import { ELM_WATCH_HOST } from "../src/Env.ts";
import { getHostFromEnv } from "../src/Host.ts";

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
