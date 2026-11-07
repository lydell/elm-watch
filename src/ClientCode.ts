// In production this file is replaced with a simple one that just reads
// pre-compiled JS from a file.

import * as fs from "fs";
import { build } from "rolldown";

import {
  checkClientConfigIdentifier,
  clientBuildOptions,
  getOnlyChunk,
  PROXY_SRC_PATH,
} from "../scripts/Build.ts";

export const client = getOnlyChunk((await build(clientBuildOptions)).output);
checkClientConfigIdentifier(client);
export const proxy = fs.readFileSync(PROXY_SRC_PATH, "utf8");
