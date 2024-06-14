import { ELM_WATCH_HOST, Env } from "./Env";

export type Host = {
  tag: "Host";
  theHost: string;
};

export function getHost(env: Env): Host {
  return { tag: "Host", theHost: env[ELM_WATCH_HOST] ?? "0.0.0.0" };
}
