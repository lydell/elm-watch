const fs = require("fs");
const path = require("path");

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

async function run() {
  const code = await read(process.stdin);
  const tmp = path.join(__dirname, "postprocess.tmp");
  const n = Number(fs.readFileSync(tmp, "utf8"));
  fs.writeFileSync(tmp, (n + 1).toString());

  switch (n) {
    case 1:
      process.stdout.write(
        code.replace("REPLACE_ME", "postprocess content before"),
      );
      break;

    case 2:
      await wait(10000);
      process.stdout.write(
        code.replace("REPLACE_ME", "postprocess should have been killed"),
      );
      break;

    default:
      process.stdout.write(
        code.replace("REPLACE_ME", "postprocess content after"),
      );
      break;
  }
}

run(process.argv.slice(2)).then(
  (exitCode) => {
    process.exitCode = exitCode;
  },
  (error) => {
    console.error("Uncaught error:", error);
    process.exit(1);
  },
);
