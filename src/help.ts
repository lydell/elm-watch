import { bold, dim } from "./helpers";

export function render(): string {
  const elmToolingJson = bold("elm-tooling.json");

  return `
${bold("elm-watch make [--debug|--optimize] [outputs...]")}
    Compile Elm code into JS

${bold("elm-watch hot [outputs...]")}
    Recompile whenever your Elm files change,
    and reload the compiled JS in the browser

All commands read their inputs and outputs from the closest ${elmToolingJson}.
By default they build all outputs. Pass output JS file paths to only build some.

${dim("---")}

${bold("Environment variables:")}
    ${bold("NO_COLOR")}
        Disable colored output

${bold("Documentation:")}
    https://github.com/lydell/elm-watch/#readme

${bold("Version:")}
    %VERSION%
`.trim();
}
