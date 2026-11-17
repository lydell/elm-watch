import type * as os from "os";
import { describe, expect, test } from "vitest";

import { ELM_WATCH_HOST } from "../src/Env.ts";
import {
  getHostFromEnv,
  getNetworkIps,
  markAsHost,
  resolveHost,
} from "../src/Host.ts";

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

describe("getNetworkIps", () => {
  function ipv4(
    address: string,
    netmask: string,
    internal = false,
  ): os.NetworkInterfaceInfo {
    return {
      address,
      netmask,
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal,
      cidr: null,
    };
  }

  test("skips internal, IPv6, network and broadcast addresses", () => {
    expect(
      getNetworkIps({
        lo0: [ipv4("127.0.0.1", "255.0.0.0", true)],
        en0: [
          {
            address: "fe80::1",
            netmask: "ffff:ffff:ffff:ffff::",
            family: "IPv6",
            mac: "00:00:00:00:00:00",
            internal: false,
            cidr: null,
            scopeid: 14,
          },
          ipv4("192.168.0.145", "255.255.255.0"),
        ],
        // OrbStack bridges on macOS.
        bridge100: [ipv4("192.168.139.3", "255.255.254.0")],
        bridge101: [ipv4("192.168.215.0", "255.255.255.0")],
        broadcast: [ipv4("10.0.1.255", "255.255.254.0")],
        notNetwork: [ipv4("10.0.1.0", "255.255.254.0")],
        undefinedInterface: undefined,
      }),
    ).toStrictEqual(["192.168.0.145", "192.168.139.3", "10.0.1.0"]);
  });

  test("/31 and /32 have no network or broadcast addresses", () => {
    expect(
      getNetworkIps({
        a: [ipv4("10.0.0.0", "255.255.255.254")],
        b: [ipv4("10.0.0.1", "255.255.255.254")],
        c: [ipv4("10.0.0.0", "255.255.255.255")],
      }),
    ).toStrictEqual(["10.0.0.0", "10.0.0.1", "10.0.0.0"]);
  });
});
