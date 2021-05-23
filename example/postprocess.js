const fs = require("fs");
const UglifyJs = require("uglify-js");

const [outputPath, mode] = process.argv.slice(2);

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
]

switch (mode) {
  case "standard":
  case "debug":
    process.exit(0);

  case "optimize": {
    const code = fs.readFileSync(outputPath, "utf8");

    const result = UglifyJs.minify(code, {
      compress: {
        pure_funcs: pureFuncs,
        pure_getters: true,
        keep_fargs: false,
        unsafe_comps: true,
        unsafe: true,
        passes: 2
      },
      mangle: {
        reserved: pureFuncs
      }
    });

    if (result.error !== undefined) {
      process.stderr.write(result.error.message);
      process.exit(1);
    }

    fs.writeFileSync(outputPath, result.code);
    process.exit(0);
  }

  default:
    process.stderr.write(`Unknown mode: ${JSON.stringify(mode)}`);
    process.exit(1);
}
