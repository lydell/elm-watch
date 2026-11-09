// @ts-check

/**
 * Creates the postprocess function for a target.
 *
 * @param {string} targetName
 * @returns {import("elm-watch").Postprocess}
 */
export function postprocessFor(targetName) {
  return (code) => {
    if (targetName.includes("ESM")) {
      // Turn the Elm JS into an ECMAScript module:
      return `const output = {}; (function(){${code}}).call(output); export default output.Elm;`;
    } else {
      return code;
    }
  };
}
