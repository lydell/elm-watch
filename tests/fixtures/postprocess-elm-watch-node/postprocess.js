const fs = require("fs");
const path = require("path");

const postprocess = (args) => {
  if (args.length !== 4) {
    return {
      exitCode: 1,
      stderr: `Expected 4 args but got ${args.length}: ${JSON.stringify(args)}`,
    };
  }

  const [arg1, arg2, outputPath, mode] = args;

  const expectedArg1 = "arg1";
  if (arg1 !== expectedArg1) {
    return {
      exitCode: 1,
      stderr: `Expected arg 1 to be ${JSON.stringify(
        expectedArg1
      )} but got: ${JSON.stringify(arg1)}`,
    };
  }

  const expectedArg2 = "arg number $two";
  if (arg2 !== expectedArg2) {
    return {
      exitCode: 1,
      stderr: `Expected arg 2 to be ${JSON.stringify(
        expectedArg2
      )} but got: ${JSON.stringify(arg2)}`,
    };
  }

  const output = fs.readFileSync(outputPath, "utf8");

  switch (mode) {
    case "standard": {
      const probe = "Compiled in DEV mode";
      if (!output.includes(probe)) {
        return {
          exitCode: 1,
          stderr: `Expected ${outputPath} to contain: ${JSON.stringify(probe)}`,
        };
      }
      break;
    }

    default:
      return {
        exitCode: 1,
        stderr: `Unexpected compilation mode: ${JSON.stringify(mode)}`,
      };
  }

  return { exitCode: 0 };
};

// This is supposed to be just `module.exports = postprocess`, but as a
// workaround for Jest we set `default`.
module.exports = { default: postprocess };
