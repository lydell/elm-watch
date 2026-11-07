import { isIP } from "net";
import * as Codec from "tiny-decoders";

import { ELM_WATCH_ALLOWED_HOSTS, Env } from "./Env";
import { Brand } from "./Types";

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
// localhost, *.localhost, *.local (mDNS) and IP addresses. More hosts can be
// allowed via "allowedHosts" in elm-watch.json, the `ELM_WATCH_ALLOWED_HOSTS`
// environment variable, and "webSocketUrl" (its hostname is allowed).
// Wildcards are not supported on purpose: They are unsafe for shared domains
// like ngrok’s. List each host exactly instead (the environment variable is
// useful for hosts that change).

export const ALLOWED_HOSTS_DOCS_LINK =
  "https://lydell.github.io/elm-watch/server/#allowed-hosts";

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
  const string = env[ELM_WATCH_ALLOWED_HOSTS];
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

export type HostCheckResult = { tag: "Allowed" } | RejectedHost;

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

export function checkOriginHeader(
  allowedHosts: ReadonlyArray<AllowedHost>,
  origin: string | undefined,
): HostCheckResult {
  // No `Origin` means the request does not come from a browser. Browsers send
  // `Origin: null` for `file://` pages, for example. Allow both: Neither can be
  // used by a web site to connect.
  if (origin === undefined || origin === "null") {
    return { tag: "Allowed" };
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
  // IPv6 addresses are wrapped in brackets in URLs.
  const unbracketed =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;
  return (
    isIP(unbracketed) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
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
