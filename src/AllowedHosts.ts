import { BlockList, isIP } from "net";
import type * as os from "os";
import * as Codec from "tiny-decoders";

import { docsLink } from "./DocsLinks.ts";
import { ELM_WATCH_ALLOWED_HOSTS, type Env, getEnvValue } from "./Env.ts";
import { getNetworkIps, type Host } from "./Host.ts";
import type { Brand } from "./Types.ts";

// elm-watch’s server only accepts requests where the `Host` header (and for
// WebSockets, also the `Origin` header) is one of the allowed hosts:
//
// - `Host` protects against DNS rebinding: A malicious web site can make its
//   domain resolve to 127.0.0.1, and then read files from elm-watch’s server as
//   if they were its own. Then the `Host` header contains the malicious domain.
// - `Origin` protects against other web sites connecting to elm-watch’s
//   WebSocket. They can get the WebSocket token by loading the compiled JS
//   via a `<script>` tag.
//
// Some hosts are always allowed, since they can’t be registered in public DNS:
// localhost, *.localhost, *.local (mDNS) and IP addresses that can’t be on the
// public internet (loopback, private networks and link-local). Public IP
// addresses are not allowed: A web site served on a public IP address could
// otherwise connect to the WebSocket. The hosts of the links elm-watch prints
// for its server are also allowed (see `getServerLinkHosts`). More hosts
// (including IP addresses) can be allowed via "allowedHosts" in elm-watch.json, the `ELM_WATCH_ALLOWED_HOSTS`
// environment variable, and "webSocketUrl" (its hostname is allowed).
// Wildcards are not supported on purpose: They are unsafe for shared domains
// like ngrok’s. List each host exactly instead (the environment variable is
// useful for hosts that change).

export const ALLOWED_HOSTS_DOCS_LINK = docsLink("allowed-hosts");

// A normalized hostname: Lowercase, punycode and no trailing dot.
export type AllowedHost = Brand<string, "AllowedHost">;

export const AllowedHost: Codec.Codec<AllowedHost, string> = Codec.flatMap(
  Codec.string,
  {
    decoder: (string) => {
      const result = parseAllowedHost(string);
      switch (result.tag) {
        case "Valid":
          return result;
        case "Invalid":
          return {
            tag: "DecoderError",
            error: {
              tag: "custom",
              message: result.message,
              got: string,
              path: [],
            },
          };
      }
    },
    encoder: (allowedHost) => allowedHost,
  },
);

const NOT_A_BARE_HOSTNAME_REGEX = /[\s:/?#@[\]\\]/;

function parseAllowedHost(
  string: string,
): { tag: "Valid"; value: AllowedHost } | { tag: "Invalid"; message: string } {
  if (string.startsWith(".") || string.includes("*")) {
    return {
      tag: "Invalid",
      message:
        "Wildcards are not supported. List each host exactly instead, for example: dev.example.com",
    };
  }
  // IPv6 addresses contain colons, so check them before the port check below.
  // Both `::1` and `[::1]` are accepted.
  const unbracketed = unbracketIpv6(string);
  if (isIP(unbracketed) === 6) {
    const hostname = parseHostname(`[${unbracketed}]`);
    if (hostname !== undefined) {
      return { tag: "Valid", value: markAsAllowedHost(hostname) };
    }
  }
  if (NOT_A_BARE_HOSTNAME_REGEX.test(string)) {
    return {
      tag: "Invalid",
      message:
        "Expected just a hostname, without protocol, port or path. For example: dev.example.com",
    };
  }
  const hostname = parseHostname(string);
  return hostname === undefined
    ? {
        tag: "Invalid",
        message: "Expected a hostname, for example: dev.example.com",
      }
    : { tag: "Valid", value: markAsAllowedHost(hostname) };
}

function markAsAllowedHost(hostname: string): AllowedHost {
  return hostname as AllowedHost;
}

// Invalid hosts in the environment variable are silently ignored, just like
// for other environment variables.
export function getAllowedHostsFromEnv(env: Env): Array<AllowedHost> {
  const string = getEnvValue(env, ELM_WATCH_ALLOWED_HOSTS);
  if (string === undefined) {
    return [];
  }
  return string.split(",").flatMap((part) => {
    const result = parseAllowedHost(part.trim());
    switch (result.tag) {
      case "Valid":
        return [result.value];
      case "Invalid":
        return [];
    }
  });
}

export function allowedHostFromUrl(url: URL): AllowedHost {
  return markAsAllowedHost(normalizeHostname(url.hostname));
}

type HostCheckResult = { tag: "Allowed" } | RejectedHost;

export type RejectedHost =
  | { tag: "NotAllowed"; hostname: string }
  | { tag: "Invalid"; value: string | undefined };

export function checkHostHeader(
  allowedHosts: ReadonlyArray<AllowedHost>,
  host: string | undefined,
): HostCheckResult {
  const hostname =
    host === undefined || /[\s/?#@\\]/.test(host)
      ? undefined
      : parseHostname(host);
  return hostname === undefined
    ? { tag: "Invalid", value: host }
    : checkHostname(allowedHosts, hostname);
}

export type RejectedOrigin = RejectedHost | { tag: "NullOrigin" };

export function checkOriginHeader(
  allowedHosts: ReadonlyArray<AllowedHost>,
  origin: string | undefined,
): { tag: "Allowed" } | RejectedOrigin {
  // No `Origin` means the request does not come from a browser (browsers always
  // send it for WebSockets).
  if (origin === undefined) {
    return { tag: "Allowed" };
  }
  // Browsers send `Origin: null` for `file://` pages, but also for sandboxed
  // iframes, which any web site can create. There is no way to tell them apart,
  // so `file://` pages are not supported.
  if (origin === "null") {
    return { tag: "NullOrigin" };
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    return { tag: "Invalid", value: origin };
  }
  const hostname = normalizeHostname(url.hostname);
  return hostname === ""
    ? { tag: "Invalid", value: origin }
    : checkHostname(allowedHosts, hostname);
}

function checkHostname(
  allowedHosts: ReadonlyArray<AllowedHost>,
  hostname: string,
): HostCheckResult {
  return isAlwaysAllowed(hostname) ||
    allowedHosts.includes(markAsAllowedHost(hostname))
    ? { tag: "Allowed" }
    : { tag: "NotAllowed", hostname };
}

function isAlwaysAllowed(hostname: string): boolean {
  const unbracketed = unbracketIpv6(hostname);
  const ipVersion = isIP(unbracketed);
  return (
    (ipVersion !== 0 &&
      NON_PUBLIC_IPS.check(unbracketed, ipVersion === 4 ? "ipv4" : "ipv6")) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

// The hosts of the links elm-watch prints for its server (see
// `printServerLinks`): The `host` it listens on, or all network IP addresses
// for `0.0.0.0`. They are always allowed, so that the printed links work. Even
// public IP addresses: A page served on your own computer’s IP address is
// served by your computer, not by some web site.
export function getServerLinkHosts(
  host: Host,
  interfaces: NodeJS.Dict<Array<os.NetworkInterfaceInfo>>,
): Array<AllowedHost> {
  const hosts = host === "0.0.0.0" ? getNetworkIps(interfaces) : [host];
  return hosts.flatMap((string) => {
    const result = parseAllowedHost(string);
    switch (result.tag) {
      case "Valid":
        return [result.value];
      case "Invalid":
        return [];
    }
  });
}

// IPv6 addresses are wrapped in brackets in URLs.
function unbracketIpv6(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

// IP addresses that can’t be used by public web sites. The same as
// `BlockList.PRIVATE_RANGES`, which requires Node.js 24.21.0 or later.
// (`BlockList` also matches IPv4-mapped IPv6 addresses, like
// `::ffff:127.0.0.1`.)
const NON_PUBLIC_IPS = new BlockList();
for (const [network, prefix] of [
  ["10.0.0.0", 8], // Private network
  ["127.0.0.0", 8], // Loopback
  ["169.254.0.0", 16], // Link-local
  ["172.16.0.0", 12], // Private network
  ["192.168.0.0", 16], // Private network
] as const) {
  NON_PUBLIC_IPS.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::1", 128], // Loopback
  ["fc00::", 7], // Unique local addresses (private network)
  ["fe80::", 10], // Link-local
] as const) {
  NON_PUBLIC_IPS.addSubnet(network, prefix, "ipv6");
}

// Parses things like `example.com`, `example.com:8000` and `[::1]:8000`.
function parseHostname(host: string): string | undefined {
  let url;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return undefined;
  }
  const hostname = normalizeHostname(url.hostname);
  return hostname === "" ? undefined : hostname;
}

// `URL` already lowercases and converts to punycode. A trailing dot means the
// same host (a fully qualified domain name).
function normalizeHostname(hostname: string): string {
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}
