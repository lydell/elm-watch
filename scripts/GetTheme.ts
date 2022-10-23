/* eslint-disable no-console */

import { makeLogger } from "../src/Logger";
import { getThemeFromTerminal } from "../src/Theme";

const logger = makeLogger({
  env: process.env,
  getNow: () => new Date(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  logDebug: console.debug,
});

logger.setRawMode(() => {
  process.exit();
});

getThemeFromTerminal(logger)
  .then((theme) => {
    console.log(theme);
  })
  .catch(console.error)
  .finally(() => {
    logger.reset();
  });
