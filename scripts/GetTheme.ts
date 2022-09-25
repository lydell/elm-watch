/* eslint-disable no-console */

import { makeLogger } from "../src/Logger";
import { getThemeFromTerminal } from "../src/Theme";

const logger = makeLogger({
  env: process.env,
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  logDebug: console.debug,
});

getThemeFromTerminal(logger).then(console.log).catch(console.error);
