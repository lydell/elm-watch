async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function run(args) {
  if (args.length !== 5) {
    console.error(
      `Expected 5 args but got ${args.length}: ${JSON.stringify(args)}`
    );
    return 1;
  }

  const [arg1, arg2, targetName, compilationMode, runMode] = args;

  const expectedArg1 = "first $(arg)";
  if (arg1 !== expectedArg1) {
    console.error(
      `Expected arg 1 to be ${JSON.stringify(
        expectedArg1
      )} but got: ${JSON.stringify(arg1)}`
    );
    return 1;
  }

  const expectedArg2 = "second $arg";
  if (arg2 !== expectedArg2) {
    console.error(
      `Expected arg 2 to be ${JSON.stringify(
        expectedArg2
      )} but got: ${JSON.stringify(arg2)}`
    );
    return 1;
  }

  const expectedTargetName = "main";
  if (targetName != expectedTargetName) {
    console.error(
      `Expected targetName to be ${JSON.stringify(
        expectedTargetName
      )} but got: ${JSON.stringify(targetName)}`
    );
    return 1;
  }

  const output = await read(process.stdin);

  switch (compilationMode) {
    case "standard": {
      const probe = "Compiled in DEV mode";
      if (!output.includes(probe)) {
        console.error(`Expected stdin to contain: ${JSON.stringify(probe)}`);
        return 1;
      }
      break;
    }

    case "debug": {
      const probe = "Compiled in DEBUG mode";
      if (!output.includes(probe)) {
        console.error(`Expected stdin to contain: ${JSON.stringify(probe)}`);
        return 1;
      }
      break;
    }

    case "optimize": {
      const probe = "console.warn";
      if (output.includes(probe)) {
        console.error(
          `Expected stdin NOT to contain: ${JSON.stringify(probe)}`
        );
        return 1;
      }
      break;
    }

    default:
      console.error(
        `Unknown compilation mode: ${JSON.stringify(compilationMode)}`
      );
      return 1;
  }

  switch (runMode) {
    case "make":
      break;

    case "hot":
      console.error('Expected run mode to be "make" but got "hot".');
      return 1;

    default:
      console.error(`Unknown run mode: ${JSON.stringify(compilationMode)}`);
      return 1;
  }

  process.stdout.write(output.replace(/ {2,}/g, " "));
  return 0;
}

run(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error("Uncaught error:", error);
    process.exit(1);
  }
);
