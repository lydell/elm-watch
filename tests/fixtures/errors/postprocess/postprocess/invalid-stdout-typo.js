module.exports = require("./hack")(async () => ({
  exitCode: 0,
  stdout: JSON.stringify({
    newOutput: "main.min.js",
  }),
}));
