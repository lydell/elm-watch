import { EMOJI, emojiWidthFix } from "./Compile";
import { bold, dim, join } from "./Helpers";

const elmWatchJson = bold("elm-watch.json");

export function render({
  fancy,
  isTTY,
}: {
  fancy: boolean;
  isTTY: boolean;
}): string {
  // Not trimming on purpose.
  const symbolLegend = fancy
    ? `
${bold("Symbol legend:")}

${join(
  Object.values(EMOJI).map(({ emoji, description }) => {
    const indent = "    ";
    return `${indent}${emojiWidthFix({
      emoji,
      column: indent.length + 3,
      isTTY,
    })} ${description}`;
  }),
  "\n"
)}
`
    : "";

  return `
${bold("elm-watch init")}
    Create a minimal ${elmWatchJson} in the current directory

${bold("elm-watch make [--debug|--optimize] [targets...]")}
    Compile Elm code into JS

${bold("elm-watch hot [targets...]")}
    Recompile whenever your Elm files change,
    and reload the compiled JS in the browser

All commands read their inputs and outputs from the closest ${elmWatchJson}.
By default they build all targets. Pass target names to only build some.
Targets are matched by substring!

${dim("---")}
${symbolLegend}
${bold("Durations legend:")}

    ${bold("Q")} queued for elm make
    ${bold("E")} elm make
    ${bold("T")} elm make (typecheck only)
    ${bold("W")} find all related Elm file paths
    ${bold("I")} inject hot reloading code
    ${bold("R")} queued for postprocess
    ${bold("P")} postprocess
    ${bold(fancy ? "¦" : "/")} next is run in parallel

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
