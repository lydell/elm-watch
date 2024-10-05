// @ts-check
import * as swc from "@swc/core";

/**
 * @type {import("elm-watch/elm-watch-node").Postprocess}
 */
export default async function postprocess({
  code,
  targetName,
  compilationMode,
}) {
  switch (compilationMode) {
    case "standard":
    case "debug":
      return code;

    case "optimize":
      return minify(code);

    default:
      throw new Error(
        `Unknown compilation mode: ${JSON.stringify(compilationMode)}`,
      );
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

// Source: https://discourse.elm-lang.org/t/elm-minification-benchmarks/9968
async function minify(code) {
  return (
    await swc.minify(code, {
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
