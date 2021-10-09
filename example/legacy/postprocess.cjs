// TODO: This file is a good test, but it’s currently unused.
const UglifyJs = require("uglify-js");

const pureFuncs = [
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
];

async function read(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function postprocess([_outputPath, compilationMode]) {
  switch (compilationMode) {
    case "standard":
    case "debug":
      process.stdin.pipe(process.stdout);
      process.exitCode = 0;
      break;

    case "optimize": {
      const code = await read(process.stdin);

      const result = UglifyJs.minify(code, {
        compress: {
          pure_funcs: pureFuncs,
          pure_getters: true,
          keep_fargs: false,
          unsafe_comps: true,
          unsafe: true,
          passes: 2,
        },
        mangle: {
          reserved: pureFuncs,
        },
      });

      if (result.error !== undefined) {
        throw result.error;
      }

      process.stdout.write(result.code);

      break;
    }

    default:
      throw new Error(
        `Unknown compilation mode: ${JSON.stringify(compilationMode)}`
      );
  }
}

postprocess(process.argv.slice(2)).then(
  () => {
    process.exitCode = 0;
  },
  (error) => {
    process.exitCode = 1;
    process.stderr.write(error.message);
  }
);
