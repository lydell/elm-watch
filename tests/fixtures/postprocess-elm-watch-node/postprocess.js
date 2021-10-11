const fs = require("fs");
const path = require("path");

const postprocess = (args) => {
  if (args.length !== 6) {
    return new Error(
      `Expected 6 args but got ${args.length}: ${JSON.stringify(args)}`
    );
  }

  const [code, arg1, arg2, outputPath, compilationMode, runMode] = args;

  const expectedArg1 = "arg1";
  if (arg1 !== expectedArg1) {
    return new Error(
      `Expected arg 1 to be ${JSON.stringify(
        expectedArg1
      )} but got: ${JSON.stringify(arg1)}`
    );
  }

  const expectedArg2 = "arg number $two";
  if (arg2 !== expectedArg2) {
    return new Error(
      `Expected arg 2 to be ${JSON.stringify(
        expectedArg2
      )} but got: ${JSON.stringify(arg2)}`
    );
  }

  const output = fs.readFileSync(outputPath, "utf8");

  switch (compilationMode) {
    case "standard": {
      const probe = "Compiled in DEV mode";
      if (!output.includes(probe)) {
        return new Error(
          `Expected ${outputPath} to contain: ${JSON.stringify(probe)}`
        );
      }
      break;
    }

    default:
      return new Error(
        `Unexpected compilation mode: ${JSON.stringify(compilationMode)}`
      );
  }

  switch (runMode) {
    case "make":
      break;

    default:
      return new Error(`Unexpected run mode: ${JSON.stringify(runMode)}`);
  }

  return code;
};

// This is supposed to be just `module.exports = postprocess`, but as a
// workaround for Jest we set `default`.
module.exports = { default: postprocess };
