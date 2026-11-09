import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

import { webSocketParamsDecodeError } from "../src/Errors.ts";
import { WebSocketUrl } from "../src/WebSocketUrl.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

function decode(value: unknown): string {
  const result = WebSocketUrl("elm-watch.json").decoder(value);
  switch (result.tag) {
    case "Valid":
      return `Valid: ${result.value.url.href}`;
    case "DecoderError":
      return Codec.format(result.error);
  }
}

describe("WebSocketUrl", () => {
  test("valid", () => {
    expect(decode("ws://localhost:1234")).toMatchInlineSnapshot(
      `Valid: ws://localhost:1234/`,
    );
    expect(decode("wss://dev.example.com/elm-watch?x=1")).toMatchInlineSnapshot(
      `Valid: wss://dev.example.com/elm-watch?x=1`,
    );
  });

  test("not a string", () => {
    expect(decode(1234)).toMatchInlineSnapshot(`
      At root:
      Expected a string
      Got: 1234
    `);
  });

  test("invalid URL", () => {
    expect(decode("")).toMatchInlineSnapshot(`
      At root:
      Expected a valid URL (starting with ws: or wss:): Invalid URL
      Got: ""
    `);
    expect(decode("/elm-watch")).toMatchInlineSnapshot(`
      At root:
      Expected a valid URL (starting with ws: or wss:): Invalid URL
      Got: "/elm-watch"
    `);
    expect(decode("ws://")).toMatchInlineSnapshot(`
      At root:
      Expected a valid URL (starting with ws: or wss:): Invalid URL
      Got: "ws://"
    `);
  });

  test("not a WebSocket URL", () => {
    // `localhost:` is parsed as the protocol.
    expect(decode("localhost:1234")).toMatchInlineSnapshot(`
      At root:
      Expected a WebSocket URL, starting with ws: or wss:.
      Got: "localhost:1234"
    `);
    expect(decode("http://localhost:1234")).toMatchInlineSnapshot(`
      At root:
      Expected a WebSocket URL, starting with ws: or wss:.
      Got: "http://localhost:1234"
    `);
    expect(decode("https://dev.example.com/elm-watch")).toMatchInlineSnapshot(`
      At root:
      Expected a WebSocket URL, starting with ws: or wss:.
      Got: "https://dev.example.com/elm-watch"
    `);
  });

  test("fragment", () => {
    expect(decode("ws://localhost:1234/#hash")).toMatchInlineSnapshot(`
      At root:
      The WebSocket URL must not contain a fragment (hash).
      Got: "ws://localhost:1234/#hash"
    `);
    // An empty fragment is not visible in `url.hash`.
    expect(decode("ws://localhost:1234/#")).toMatchInlineSnapshot(`
      At root:
      The WebSocket URL must not contain a fragment (hash).
      Got: "ws://localhost:1234/#"
    `);
  });

  test("encode", () => {
    const result = WebSocketUrl("Env").decoder("wss://dev.example.com");
    if (result.tag !== "Valid") {
      throw new Error(`Expected Valid, got: ${Codec.format(result.error)}`);
    }
    expect(WebSocketUrl("Env").encoder(result.value)).toBe(
      "wss://dev.example.com/",
    );
  });
});

describe("webSocketParamsDecodeError", () => {
  const decoderResult = Codec.fields({ elmWatchVersion: Codec.string }).decoder(
    {},
  );
  if (decoderResult.tag !== "DecoderError") {
    throw new Error("Expected a DecoderError.");
  }
  const { error } = decoderResult;
  const urlParams = new URLSearchParams({ targetName: "Main" });

  test("no configured URL", () => {
    expect(webSocketParamsDecodeError(undefined, error, urlParams))
      .toMatchInlineSnapshot(`
      I ran into trouble parsing the web socket connection URL parameters:

      At root:
      Expected an object with a field called: "elmWatchVersion"
      Got: {}

      The URL parameters look like this:

      targetName=Main

      The web socket code I generate is supposed to always connect using a correct URL, so something is up here.

      Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
    `);
  });

  test("URL from each source", () => {
    expect(
      (["elm-watch.json", "Env", "Options"] as const)
        .map((source) =>
          webSocketParamsDecodeError(
            {
              tag: "UrlFromConfig",
              url: new URL("wss://dev.example.com/elm-watch"),
              source,
            },
            error,
            urlParams,
          ).trim(),
        )
        .join("\n---\n"),
    ).toMatchInlineSnapshot(`
      I ran into trouble parsing the web socket connection URL parameters:

      At root:
      Expected an object with a field called: "elmWatchVersion"
      Got: {}

      The URL parameters look like this:

      targetName=Main

      You have configured the web socket URL in elm-watch.json to:

      wss://dev.example.com/elm-watch

      Check if that URL is correct! If it goes to a proxy, make sure the proxy forwards to the correct URL.

      Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
      ---
      I ran into trouble parsing the web socket connection URL parameters:

      At root:
      Expected an object with a field called: "elmWatchVersion"
      Got: {}

      The URL parameters look like this:

      targetName=Main

      You have configured the web socket URL using the ELM_WATCH_WEBSOCKET_URL environment variable to:

      wss://dev.example.com/elm-watch

      Check if that URL is correct! If it goes to a proxy, make sure the proxy forwards to the correct URL.

      Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
      ---
      I ran into trouble parsing the web socket connection URL parameters:

      At root:
      Expected an object with a field called: "elmWatchVersion"
      Got: {}

      The URL parameters look like this:

      targetName=Main

      You have configured the web socket URL in the elm-watch options to:

      wss://dev.example.com/elm-watch

      Check if that URL is correct! If it goes to a proxy, make sure the proxy forwards to the correct URL.

      Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
    `);
  });
});
