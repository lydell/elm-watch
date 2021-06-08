module.exports = require("./hack")(async () => ({
  exitCode: 1,
  stderr: "Some text on stderr",
}));
