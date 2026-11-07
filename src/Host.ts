import { ELM_WATCH_HOST, type Env } from "./Env.ts";

export type Host = string & {
  readonly Host: never;
};

export function markAsHost(string: string): Host {
  return string as Host;
}

export function getHost(env: Env): Host {
  return markAsHost(env[ELM_WATCH_HOST] ?? "127.0.0.1");
}
