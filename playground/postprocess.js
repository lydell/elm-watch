// @ts-check
import * as swc from "@swc/core";

/**
 * Creates the postprocess function for a target.
 *
 * @param {string} targetName
 * @returns {import("elm-watch").Postprocess}
 */
export function postprocessFor(targetName) {
  return async (code, { compilationMode }) => {
    switch (compilationMode) {
      case "standard":
      case "debug":
        return patch(targetName, code);

      case "optimize":
        return minify(patch(targetName, code));
    }
  };
}

/**
 * @param {string} targetName
 * @param {string} code
 * @returns {string}
 */
function patch(targetName, code) {
  if (targetName.includes("ESM")) {
    // Turn the Elm JS into an ECMAScript module:
    return `const output = {}; (function(){${code}}).call(output); export default output.Elm;`;
  } else {
    return code;
  }
}

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

/**
 * Source: https://discourse.elm-lang.org/t/elm-minification-benchmarks/9968
 *
 * @param {string} code
 * @returns {Promise<string>}
 */
async function minify(code) {
  return (
    await swc.minify(code, {
      module: true,
      compress: {
        pure_funcs: pureFuncs,
        pure_getters: true,
        unsafe_comps: true,
        unsafe: true,
      },
      mangle: {
        reserved: pureFuncs,
      },
    })
  ).code;
}
