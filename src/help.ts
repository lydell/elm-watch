import { bold, dim } from "./helpers";

export default function help(): string {
  return `
${bold("elm-watch make [outputs...]")}
    Compile Elm code into JS

${bold("elm-watch watch [outputs...]")}
    Also recompile whenever your Elm files change

${bold("elm-watch hot [outputs...]")}
    Also reload the compiled JS in the browser

All commands read their inputs and outputs from ${bold("elm-tooling.json")}.
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
