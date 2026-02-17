import { ELM_WATCH_HOST, Env } from "./Env";

export type Host = string & {
  readonly Host: never;
};

export function markAsHost(string: string): Host {
  return string as Host;
}

export function getHost(env: Env): Host {
  return markAsHost(env[ELM_WATCH_HOST] ?? "0.0.0.0");
}
