import * as Decode from "tiny-decoders";

import { toError } from "./Helpers";
import { Port } from "./Port";

export type WebSocketConnection =
  | WebSocketUrl
  | {
      tag: "AutomaticUrl";
      port: Port;
    };

export type WebSocketUrl = {
  tag: "UrlFromConfig";
  url: URL;
  source: "elm-watch.json" | "Env";
};

export function WebSocketUrl(
  source: WebSocketUrl["source"]
): Decode.Decoder<WebSocketUrl> {
  return Decode.chain(Decode.string, (urlString): WebSocketUrl => {
    let url;
    try {
      url = new URL(urlString);
    } catch (unknownError) {
      const error = toError(unknownError);
      throw new Decode.DecoderError({
        message: `Expected a valid URL (starting with ws: or wss:): ${error.message}`,
        value: urlString,
      });
    }
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Decode.DecoderError({
        message: `Expected a WebSocket URL, starting with ws: or wss:.`,
        value: urlString,
      });
    }
    if (url.hash !== "" || url.href.endsWith("#")) {
      throw new Decode.DecoderError({
        message: `The WebSocket URL must not contain a fragment (hash).`,
        value: urlString,
      });
    }
    return {
      tag: "UrlFromConfig",
      url,
      source,
    };
  });
}

export function webSocketConnectionToPrimitive(
  webSocketConnection: WebSocketConnection
): number | string {
  switch (webSocketConnection.tag) {
    case "AutomaticUrl":
      return webSocketConnection.port.thePort;
    case "UrlFromConfig":
      return webSocketConnection.url.toString();
  }
}
