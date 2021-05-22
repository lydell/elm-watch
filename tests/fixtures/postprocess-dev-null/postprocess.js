const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);

if (args.length !== 2) {
  console.error(
    `Expected 2 args but got ${args.length}: ${JSON.stringify(args)}`
  );
  process.exit(1);
}

const [outputPath] = args;

const expectedOutputPath = "/dev/null";
if (outputPath !== expectedOutputPath) {
  console.error(
    `Expected arg 1 to be ${JSON.stringify(
      expectedOutputPath
    )} but got: ${JSON.stringify(outputPath)}`
  );
  process.exit(1);
}

const build = path.join(__dirname, "build");
if (fs.existsSync(build)) {
  console.error(`Expected ${JSON.stringify(build)} not to exist`);
  process.exit(1);
}

process.exit(0);
