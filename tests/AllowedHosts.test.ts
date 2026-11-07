import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

import {
  AllowedHost,
  allowedHostFromUrl,
  checkHostHeader,
  checkOriginHeader,
  getAllowedHostsFromEnv,
} from "../src/AllowedHosts.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

function decodeAllowedHosts(value: unknown): Array<AllowedHost> {
  const result = Codec.array(AllowedHost).decoder(value);
  switch (result.tag) {
    case "Valid":
      return result.value;
    case "DecoderError":
      throw new Error(Codec.format(result.error));
  }
}

function decodeError(value: unknown): string {
  const result = AllowedHost.decoder(value);
  switch (result.tag) {
    case "Valid":
      throw new Error(`Expected a decoder error but got: ${result.value}`);
    case "DecoderError":
      return Codec.format(result.error);
  }
}

describe("AllowedHosts", () => {
  describe("decoder", () => {
    test("normalizes", () => {
      expect(
        decodeAllowedHosts([
          "dev.example.com",
          "Dev.Example.COM",
          "dev.example.com.",
          "bücher.example",
        ]),
      ).toStrictEqual([
        "dev.example.com",
        "dev.example.com",
        "dev.example.com",
        "xn--bcher-kva.example",
      ]);
    });

    test("wildcards", () => {
      expect(decodeError(".example.com")).toMatchInlineSnapshot(`
        At root:
        Wildcards are not supported. List each host exactly instead, for example: dev.example.com
        Got: ".example.com"
      `);
      expect(decodeError("*.example.com")).toMatchInlineSnapshot(`
        At root:
        Wildcards are not supported. List each host exactly instead, for example: dev.example.com
        Got: "*.example.com"
      `);
    });

    test("not a bare hostname", () => {
      for (const value of [
        "https://dev.example.com",
        "dev.example.com:8000",
        "dev.example.com/",
        "dev.example.com/path",
        "dev.example.com?query",
        "dev.example.com#hash",
        "user@dev.example.com",
        "[::1]",
        "dev example.com",
        "dev.example.com ",
      ]) {
        expect(decodeError(value)).toContain(
          "Expected just a hostname, without protocol, port or path.",
        );
      }
    });

    test("invalid hostname", () => {
      expect(decodeError("")).toMatchInlineSnapshot(`
        At root:
        Expected a hostname, for example: dev.example.com
        Got: ""
      `);
      expect(decodeError("a%b")).toMatchInlineSnapshot(`
        At root:
        Expected a hostname, for example: dev.example.com
        Got: "a%b"
      `);
    });
  });

  test("encoder", () => {
    expect(
      Codec.array(AllowedHost).encoder(decodeAllowedHosts(["Dev.Example.com"])),
    ).toStrictEqual(["dev.example.com"]);
  });

  test("allowedHostFromUrl", () => {
    expect(
      allowedHostFromUrl(new URL("wss://Dev.Example.com.:8443/elm-watch")),
    ).toBe("dev.example.com");
  });

  test("getAllowedHostsFromEnv", () => {
    expect(getAllowedHostsFromEnv({})).toStrictEqual([]);
    expect(
      getAllowedHostsFromEnv({ ELM_WATCH_ALLOWED_HOSTS: "" }),
    ).toStrictEqual([]);
    expect(
      getAllowedHostsFromEnv({
        ELM_WATCH_ALLOWED_HOSTS:
          " a.example.com, B.example.com,,.wildcard.com,https://c.example.com,d.example.com ",
      }),
    ).toStrictEqual(["a.example.com", "b.example.com", "d.example.com"]);
  });

  describe("checkHostHeader", () => {
    const allowedHosts = decodeAllowedHosts(["dev.example.com"]);

    test("always allowed", () => {
      for (const host of [
        "localhost",
        "localhost:8000",
        "LOCALHOST:8000",
        "localhost.:8000",
        "foo.localhost",
        "foo.localhost:8000",
        "my-macbook.local",
        "my-macbook.local:8000",
        "127.0.0.1",
        "127.0.0.1:8000",
        "192.168.0.1:8000",
        "[::1]",
        "[::1]:8000",
        "[fe80::1]:8000",
      ]) {
        expect(checkHostHeader([], host)).toStrictEqual({ tag: "Allowed" });
      }
    });

    test("allowed hosts", () => {
      for (const host of [
        "dev.example.com",
        "dev.example.com:8000",
        "Dev.Example.com:8000",
        "dev.example.com.:8000",
      ]) {
        expect(checkHostHeader(allowedHosts, host)).toStrictEqual({
          tag: "Allowed",
        });
      }
    });

    test("not allowed", () => {
      for (const [host, hostname] of [
        ["evil.com", "evil.com"],
        ["evil.com:8000", "evil.com"],
        ["example.com", "example.com"],
        ["sub.dev.example.com", "sub.dev.example.com"],
        ["dev.example.com.evil.com", "dev.example.com.evil.com"],
        ["localhost.evil.com", "localhost.evil.com"],
        ["local", "local"],
        ["evil-local", "evil-local"],
      ] as const) {
        expect(checkHostHeader(allowedHosts, host)).toStrictEqual({
          tag: "NotAllowed",
          hostname,
        });
      }
    });

    test("invalid", () => {
      for (const host of [
        undefined,
        "",
        ".",
        ":8000",
        "evil.com/",
        "evil.com@localhost",
        "localhost?",
        "localhost#",
        "local host",
        "localhost\\",
      ]) {
        expect(checkHostHeader(allowedHosts, host)).toStrictEqual({
          tag: "Invalid",
          value: host,
        });
      }
    });
  });

  describe("checkOriginHeader", () => {
    const allowedHosts = decodeAllowedHosts(["dev.example.com"]);

    test("allowed", () => {
      for (const origin of [
        undefined,
        "null",
        "http://localhost:3000",
        "https://foo.localhost",
        "http://my-macbook.local:9001",
        "http://10.20.30.40:9001",
        "http://[::1]:3000",
        "https://dev.example.com",
        "https://dev.example.com:8443",
      ]) {
        expect(checkOriginHeader(allowedHosts, origin)).toStrictEqual({
          tag: "Allowed",
        });
      }
    });

    test("not allowed", () => {
      for (const [origin, hostname] of [
        ["https://evil.com", "evil.com"],
        ["https://savr-someone.ngrok.dev", "savr-someone.ngrok.dev"],
        ["http://localhost.evil.com:8000", "localhost.evil.com"],
        ["chrome-extension://abcdef", "abcdef"],
      ] as const) {
        expect(checkOriginHeader(allowedHosts, origin)).toStrictEqual({
          tag: "NotAllowed",
          hostname,
        });
      }
    });

    test("invalid", () => {
      for (const origin of ["", "localhost", "file://", "not a url"]) {
        expect(checkOriginHeader(allowedHosts, origin)).toStrictEqual({
          tag: "Invalid",
          value: origin,
        });
      }
    });
  });
});
