const spawn = require("cross-spawn");
const path = require("path");

if (process.argv.some((arg) => arg.includes("ElmWatchDummy"))) {
  spawn("elm", process.argv.slice(2), {
    env: {
      ...process.env,
      PATH: process.env.PATH.split(path.delimiter)
        .filter((part) => !part.includes("bad-bin"))
        .join(path.delimiter),
    },
    stdio: "inherit",
  });
  module.exports = false;
} else {
  module.exports = true;
}
