// In development (and in tests), the client code is bundled when this module
// is loaded. In the build, this module is replaced with the bundled code as
// strings. See scripts/Build.ts.

import * as fs from "fs";
import * as path from "path";
import { build } from "rolldown";

import { CLIENT_CONFIG_IDENTIFIER } from "./ClientConfig.ts";

const CLIENT_DIR = path.join(path.dirname(import.meta.dirname), "client");

async function bundleClient(): Promise<string> {
  const result = await build({
    input: path.join(CLIENT_DIR, "client.ts"),
    platform: "browser",
    output: { format: "iife", strict: true },
    write: false,
  });

  const [chunk, ...rest] = result.output;

  if (rest.length > 0) {
    throw new Error(
      `ClientCode: Expected a single chunk, but got: ${result.output.map((item) => item.fileName).join(", ")}`,
    );
  }

  // Make sure that the client config identifier survived bundling, exactly once
  // (so that the config object isn’t duplicated).
  const count = chunk.code.split(CLIENT_CONFIG_IDENTIFIER).length - 1;
  if (count !== 1) {
    throw new Error(
      `ClientCode: Expected ${CLIENT_CONFIG_IDENTIFIER} to occur exactly once in the bundled client code, but found it ${count} times.`,
    );
  }

  return chunk.code;
}

export const client = await bundleClient();
export const proxy = fs.readFileSync(path.join(CLIENT_DIR, "proxy.js"), "utf8");
