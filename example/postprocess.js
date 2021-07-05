import * as fs from "fs";
import * as UglifyJs from "uglify-js";

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

export default function postprocess([outputPath, compilationMode]) {
  switch (compilationMode) {
    case "standard":
    case "debug":
      return { exitCode: 0 };

    case "optimize": {
      const code = fs.readFileSync(outputPath, "utf8");

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
        return {
          exitCode: 1,
          stderr: result.error.message,
        };
      }

      fs.writeFileSync(outputPath, result.code);
      return { exitCode: 0 };
    }

    default:
      return {
        exitCode: 1,
        stderr: `Unknown mode: ${JSON.stringify(compilationMode)}`,
      };
  }
}
