import type * as os from "os";
import { describe, expect, test } from "vitest";

import { ELM_WATCH_HOST } from "../src/Env.ts";
import {
  getHostFromEnv,
  getNetworkIps,
  markAsHost,
  printServerLinks,
  resolveHost,
  type ServerLinks,
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

describe("printServerLinks", () => {
  function print(
    host: string,
    networkIps: Array<string>,
    serverLinks?: ServerLinks,
  ): string | undefined {
    return printServerLinks({
      protocol: "http",
      port: 1234,
      host: markAsHost(host),
      networkIps,
      serverLinks,
    })?.replace(/\x1B\[\d*m/g, "");
  }

  test("localhost", () => {
    expect(print("127.0.0.1", ["192.168.0.1"])).toBe("http://localhost:1234");
  });

  test("specific host", () => {
    expect(print("192.168.0.1", ["192.168.0.2"])).toBe(
      "http://192.168.0.1:1234",
    );
  });

  test("IPv6 host", () => {
    expect(print("::1", [])).toBe("http://[::1]:1234");
  });

  test("all interfaces, no network addresses", () => {
    expect(print("0.0.0.0", [])).toBe("http://localhost:1234");
  });

  test("all interfaces, one network address", () => {
    expect(print("0.0.0.0", ["192.168.0.1"])).toBe(
      "http://localhost:1234   network: http://192.168.0.1:1234",
    );
  });

  test("all interfaces, several network addresses", () => {
    expect(print("0.0.0.0", ["192.168.0.1", "192.168.139.3"])).toBe(
      "http://localhost:1234   network: http://192.168.0.1:1234   http://192.168.139.3:1234",
    );
  });

  describe("serverLinks", () => {
    test("default links as URLs, printed without trailing slash", () => {
      const calls: Array<unknown> = [];
      expect(
        print("0.0.0.0", ["192.168.0.1"], (links) => {
          calls.push(links);
          return [links.local, ...links.network];
        }),
      ).toBe("http://localhost:1234   http://192.168.0.1:1234");
      expect(calls).toStrictEqual([
        {
          local: new URL("http://localhost:1234"),
          network: [new URL("http://192.168.0.1:1234")],
        },
      ]);
    });

    test("network is empty unless listening on all interfaces", () => {
      expect(
        print("::1", ["192.168.0.1"], ({ local, network }) => [
          local,
          ...network,
        ]),
      ).toBe("http://[::1]:1234");
    });

    test("empty array hides the line", () => {
      expect(print("127.0.0.1", [], () => [])).toBeUndefined();
    });

    test("modified URLs and strings", () => {
      expect(
        print("127.0.0.1", [], ({ local }) => {
          const admin = new URL(local);
          admin.hostname = `admin.${local.hostname}`;
          local.pathname = "/app/";
          return [local, admin, "http://localhost:5173", "https://x.test:443"];
        }),
      ).toBe(
        "http://localhost:1234/app/   http://admin.localhost:1234   http://localhost:5173   https://x.test",
      );
    });

    test("fresh URL instances on every call", () => {
      const serverLinks: ServerLinks = ({ local }) => {
        local.port = String(Number(local.port) + 1);
        return [local];
      };
      expect(print("127.0.0.1", [], serverLinks)).toBe("http://localhost:1235");
      expect(print("127.0.0.1", [], serverLinks)).toBe("http://localhost:1235");
    });

    test("throws", () => {
      expect(
        print("127.0.0.1", [], () => {
          throw new Error("Oops\nsecond line");
        }),
      ).toBe("serverLinks threw an error: Oops");
    });

    test("returns a non-array", () => {
      expect(
        print("127.0.0.1", [], () => "http://localhost" as unknown as []),
      ).toBe('serverLinks must return an array, but got: "http://localhost"');
    });

    test("returns an invalid URL", () => {
      expect(
        print("127.0.0.1", [], () => [
          "http://localhost:1234",
          "localhost:5173",
        ]),
      ).toBe(
        'serverLinks must return http(s) URLs (URL objects or strings), but got: "localhost:5173"',
      );
    });
  });
});
