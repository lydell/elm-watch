import * as Codec from "tiny-decoders";

import { ELM_WATCH_HOST, type Env } from "./Env.ts";

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

export function getHostFromEnv(env: Env): Host | undefined {
  const string = env[ELM_WATCH_HOST];
  return string === undefined ? undefined : markAsHost(string);
}
