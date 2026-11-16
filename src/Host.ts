import * as Codec from "tiny-decoders";

import { ELM_WATCH_HOST, type Env, getEnvValue } from "./Env.ts";

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
