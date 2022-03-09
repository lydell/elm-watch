const path = require("path");

module.exports = (input) => {
  if (Object.keys(input).length !== 5) {
    return new Error(
      `Expected 5 keys but got ${Object.keys(input).length}: ${JSON.stringify(
        input
      )}`
    );
  }

  const { code, targetName, compilationMode, runMode, argv } = input;

  if (argv.length !== 4) {
    return new Error(
      `Expected 4 argv but got ${argv.length}: ${JSON.stringify(argv)}`
    );
  }

  const [name, file, arg1, arg2] = argv;

  const expectedName = "elm-watch-node";
  if (name !== expectedName) {
    return new Error(
      `Expected name to be ${JSON.stringify(
        expectedName
      )} but got: ${JSON.stringify(name)}`
    );
  }

  const expectedFile = "postprocess.js";
  const split = expectedFile.split(path.sep);
  const last = split[split.length - 1];
  if (last !== expectedFile) {
    return new Error(
      `Expected last segment of file to be ${JSON.stringify(
        expectedFile
      )} but got: ${JSON.stringify(file)}`
    );
  }

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

  const expectedTargetName = "main";
  if (targetName !== expectedTargetName) {
    return new Error(
      `Expected targetName to be ${JSON.stringify(
        expectedTargetName
      )} but got: ${JSON.stringify(targetName)}`
    );
  }

  switch (compilationMode) {
    case "standard": {
      const probe = "Compiled in DEV mode";
      if (!code.includes(probe)) {
        return new Error(
          `Expected the passed code to contain: ${JSON.stringify(probe)}`
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
