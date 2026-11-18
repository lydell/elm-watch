import type * as os from "os";
import * as Codec from "tiny-decoders";

import { ELM_WATCH_HOST, type Env, getEnvValue } from "./Env.ts";
import { dim } from "./Helpers.ts";

export type Host = string & {
  readonly Host: never;
};

export function markAsHost(string: string): Host {
  return string as Host;
}

export const Host: Codec.Codec<Host, string> = Codec.map(Codec.string, {
  decoder: markAsHost,
  encoder: (host) => host,
});

export const DEFAULT_HOST = markAsHost("127.0.0.1");

// Where the host comes from, for error messages. "Config" is elm-watch.json or
// the JavaScript API, depending on the `ConfigSource`.
export type HostSource = "Env" | "Config" | "Default";

// The environment variable is each developer’s own setting, so it takes
// precedence over the project’s config.
export function resolveHost(
  env: Env,
  configHost: Host | undefined,
): { host: Host; hostSource: HostSource } {
  const hostFromEnv = getHostFromEnv(env);
  return hostFromEnv !== undefined
    ? { host: hostFromEnv, hostSource: "Env" }
    : configHost !== undefined
      ? { host: configHost, hostSource: "Config" }
      : { host: DEFAULT_HOST, hostSource: "Default" };
}

export function getHostFromEnv(env: Env): Host | undefined {
  const string = getEnvValue(env, ELM_WATCH_HOST);
  return string === undefined ? undefined : markAsHost(string);
}

export function printServerLinks({
  protocol,
  port,
  host,
  networkIps,
}: {
  protocol: "http" | "https";
  port: number;
  host: Host;
  networkIps: Array<string>;
}): string {
  if (host !== "0.0.0.0") {
    // `localhost` is easier to read, and the same thing in practice.
    const hostname =
      host === "127.0.0.1"
        ? "localhost"
        : host.includes(":")
          ? `[${host}]` // IPv6
          : host;
    return `${protocol}://${hostname}:${port}`;
  }

  const local = `${protocol}://localhost:${port}`;

  if (networkIps.length === 0) {
    return local;
  }

  const network = networkIps
    .map((ip) => `${protocol}://${ip}:${port}`)
    .join("   ");

  return `${local}   ${dim("network:")} ${network}`;
}

// The IPv4 addresses to print as links when listening on all interfaces.
// Network and broadcast addresses (host bits all zeros or all ones) can’t be
// connected to, so skip them. For example, OrbStack gives the Mac
// 192.168.215.0/24 on one of its bridges. /31 and /32 subnets have no network
// or broadcast addresses.
export function getNetworkIps(
  interfaces: NodeJS.Dict<Array<os.NetworkInterfaceInfo>>,
): Array<string> {
  return Object.values(interfaces)
    .flatMap((addresses = []) =>
      addresses.filter(
        (address) =>
          address.family === "IPv4" &&
          !address.internal &&
          !isNetworkOrBroadcastAddress(address.address, address.netmask),
      ),
    )
    .map(({ address }) => address);
}

function isNetworkOrBroadcastAddress(
  address: string,
  netmask: string,
): boolean {
  const ip = ipv4ToNumber(address);
  const mask = ipv4ToNumber(netmask);
  if (ip === undefined || mask === undefined || mask >>> 0 >= 0xfffffffe) {
    return false;
  }
  const hostBits = ip & ~mask;
  return hostBits === 0 || hostBits === ~mask;
}

function ipv4ToNumber(ip: string): number | undefined {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts.reduce((acc, part) => (acc << 8) | part, 0)
    : undefined;
}
