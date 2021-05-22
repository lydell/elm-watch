const fs = require("fs");
const UglifyJs = require("uglify-js");

const [outputPath, mode] = process.argv.slice(2);

switch (mode) {
  case "standard":
  case "debug":
    process.exit(0);

  case "optimize": {
    const code = fs.readFileSync(outputPath, "utf8");

    // TODO: Pass compress/mangle options.
    const result = UglifyJs.minify(code);

    if (result.error !== undefined) {
      process.stderr.write(error);
      process.exit(1);
    }

    fs.writeFileSync(outputPath, result.code);
    process.exit(0);
  }

  default:
    process.stderr.write(`Unknown mode: ${JSON.stringify(mode)}`);
    process.exit(1);
}
