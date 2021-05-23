const fs = require("fs");
const UglifyJs = require("uglify-js");

const [outputPath, mode] = process.argv.slice(2);

switch (mode) {
  case "standard":
  case "debug":
    process.exit(0);

  case "optimize": {
    const code = fs.readFileSync(outputPath, "utf8");

    const result1 = UglifyJs.minify(code, {
      compress: {
        pure_funcs: [
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
        ],
        pure_getters: true,
        keep_fargs: false,
        unsafe_comps: true,
        unsafe: true,
      },
      mangle: false
    });

    if (result1.error !== undefined) {
      process.stderr.write(result1.error.message);
      process.exit(1);
    }

    const result2 = UglifyJs.minify(result1.code, {
      compress: false,
      mangle: true
    });

    if (result2.error !== undefined) {
      process.stderr.write(result2.error.message);
      process.exit(1);
    }

    fs.writeFileSync(outputPath, result2.code);
    process.exit(0);
  }

  default:
    process.stderr.write(`Unknown mode: ${JSON.stringify(mode)}`);
    process.exit(1);
}
