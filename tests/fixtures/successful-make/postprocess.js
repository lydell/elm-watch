const fs = require("fs");

process.stdin.pipe(process.stdout);

const args = process.argv.slice(2);

if (args.length !== 5) {
  console.error(
    `Expected 5 args but got ${args.length}: ${JSON.stringify(args)}`
  );
  process.exit(1);
}

const [arg1, arg2, outputPath, compilationMode, runMode] = args;

const expectedArg1 = "first $(arg)";
if (arg1 !== expectedArg1) {
  console.error(
    `Expected arg 1 to be ${JSON.stringify(
      expectedArg1
    )} but got: ${JSON.stringify(arg1)}`
  );
  process.exit(1);
}

const expectedArg2 = "second $arg";
if (arg2 !== expectedArg2) {
  console.error(
    `Expected arg 2 to be ${JSON.stringify(
      expectedArg2
    )} but got: ${JSON.stringify(arg2)}`
  );
  process.exit(1);
}

const output = fs.readFileSync(outputPath, "utf8");

switch (compilationMode) {
  case "standard": {
    const probe = "Compiled in DEV mode";
    if (!output.includes(probe)) {
      console.error(
        `Expected ${outputPath} to contain: ${JSON.stringify(probe)}`
      );
      process.exit(1);
    }
    break;
  }

  case "debug": {
    const probe = "Compiled in DEBUG mode";
    if (!output.includes(probe)) {
      console.error(
        `Expected ${outputPath} to contain: ${JSON.stringify(probe)}`
      );
      process.exit(1);
    }
    break;
  }

  case "optimize": {
    const probe = "console.warn";
    if (output.includes(probe)) {
      console.error(
        `Expected ${outputPath} NOT to contain: ${JSON.stringify(probe)}`
      );
      process.exit(1);
    }
    break;
  }

  default:
    console.error(
      `Unknown compilation mode: ${JSON.stringify(compilationMode)}`
    );
    process.exit(1);
}

switch (runMode) {
  case "make":
    break;

  case "hot":
    console.error('Expected run mode to be "make" but got "hot".');
    process.exit(1);

  default:
    console.error(`Unknown run mode: ${JSON.stringify(compilationMode)}`);
    process.exit(1);
}
