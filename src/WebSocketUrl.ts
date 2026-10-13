import * as Codec from "tiny-decoders";

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
  source: WebSocketUrl["source"],
): Codec.Codec<WebSocketUrl> {
  return Codec.flatMap(Codec.string, {
    decoder: (urlString) => {
      let url;
      try {
        url = new URL(urlString);
      } catch (unknownError) {
        const error = toError(unknownError);
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: `Expected a valid URL (starting with ws: or wss:): ${error.message}`,
            got: urlString,
            path: [],
          },
        };
      }
      if (url.protocol !== "ws:" && url.protocol !== "wss:") {
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: `Expected a WebSocket URL, starting with ws: or wss:.`,
            got: urlString,
            path: [],
          },
        };
      }
      if (url.hash !== "" || url.href.endsWith("#")) {
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: `The WebSocket URL must not contain a fragment (hash).`,
            got: urlString,
            path: [],
          },
        };
      }
      return {
        tag: "Valid",
        value: {
          tag: "UrlFromConfig",
          url,
          source,
        },
      };
    },
    encoder: (webSocketUrl) => webSocketUrl.url.href,
  });
}

export function webSocketConnectionToPrimitive(
  webSocketConnection: WebSocketConnection,
): number | string {
  switch (webSocketConnection.tag) {
    case "AutomaticUrl":
      return webSocketConnection.port;
    case "UrlFromConfig":
      return webSocketConnection.url.toString();
  }
}
