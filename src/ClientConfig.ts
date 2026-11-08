import type { CompilationModeWithProxy } from "./Types.ts";

// The client code is bundled once, but some values are only known when
// injecting it into a target’s output. The client code reads them from this
// global identifier, which `clientCode` in Inject.ts replaces with an object
// literal. Bundlers leave unknown globals alone (unlike string placeholders,
// which they might fold or inline), so this survives tree shaking and
// minification.
export const CLIENT_CONFIG_IDENTIFIER = "__ELM_WATCH_CLIENT_CONFIG__";

export type ClientConfig = {
  targetName: string;
  initialElmCompiledTimestamp: number;
  originalCompilationMode: CompilationModeWithProxy;
  // A port number or a full URL.
  webSocketConnection: number | string;
  webSocketToken: string;
  debug: boolean;
};
