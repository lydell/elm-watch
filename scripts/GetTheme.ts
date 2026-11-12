/* oxlint-disable no-console */

import { makeTerminal } from "../src/Terminal.ts";
import { getThemeFromTerminal } from "../src/Theme.ts";

const terminal = makeTerminal({
  env: process.env,
  getNow: () => new Date(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  logDebug: console.debug,
});

terminal.setRawMode(() => {
  process.exit();
});

getThemeFromTerminal(terminal)
  .then((theme) => {
    console.log(theme);
  })
  .catch(console.error)
  .finally(() => {
    terminal.reset();
  });
