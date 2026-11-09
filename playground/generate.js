// @ts-check
import * as fs from "node:fs";
import * as path from "node:path";

// Generates Elm projects with lots of targets in `generated/`, to see how
// elm-watch’s terminal output looks with many targets, several elm.json files
// (one “Dependencies” line per elm.json) and compilations that take a while.
//
// Each project has its own elm.json with an extra dependency, and two targets:
// a small one and a large one. The large one imports a module with thousands
// of functions, which takes Elm a while to compile.
//
// The projects’ elm-stuff folders are deleted on every start, so that Elm has
// to compile everything from scratch every time.

const GENERATED_DIR = "generated";
const PAGE_DIR = path.join("public", GENERATED_DIR);

/**
 * @typedef {{
 *   name: string,
 *   direct: Record<string, string>,
 *   indirect: Record<string, string>,
 *   size: number,
 * }} Project
 */

/** @type {Array<Project>} */
const PROJECTS = [
  {
    name: "Regex",
    direct: { "elm/regex": "1.0.0" },
    indirect: {},
    size: 1000,
  },
  {
    name: "Parser",
    direct: { "elm/parser": "1.1.0" },
    indirect: {},
    size: 2500,
  },
  {
    name: "Random",
    direct: { "elm/random": "1.0.0" },
    indirect: {},
    size: 5000,
  },
  {
    name: "Http",
    direct: { "elm/http": "2.0.0" },
    indirect: { "elm/bytes": "1.0.8", "elm/file": "1.0.5" },
    size: 10000,
  },
];

/**
 * Writes the generated projects and returns their targets.
 *
 * @param {string} root
 * @param {number} scale Multiplies the size of the large targets.
 * @returns {Array<{ name: string, elmJson: string, inputs: [string], output: string }>}
 */
export function generate(root, scale) {
  const targets = PROJECTS.flatMap((project) => {
    const dir = path.join(GENERATED_DIR, project.name);
    const size = Math.round(project.size * scale);
    fs.rmSync(path.join(root, dir, "elm-stuff"), {
      recursive: true,
      force: true,
    });
    writeIfChanged(path.join(root, dir, "elm.json"), elmJson(project));
    writeIfChanged(
      path.join(root, dir, "src", "Big.elm"),
      bigModule(project.name, size),
    );
    return ["Small", "Large"].map((variant) => {
      const moduleName = `${project.name}${variant}`;
      writeIfChanged(
        path.join(root, dir, "src", `${moduleName}.elm`),
        mainModule(
          moduleName,
          `${project.name} ${variant}`,
          variant === "Large" ? size : 0,
        ),
      );
      return {
        name: `${project.name} ${variant}`,
        elmJson: path.join(dir, "elm.json"),
        /** @type {[string]} */
        inputs: [path.join(dir, "src", `${moduleName}.elm`)],
        output: `public/build/${GENERATED_DIR}/${moduleName}.js`,
      };
    });
  });

  writeIfChanged(
    path.join(root, PAGE_DIR, "index.html"),
    page(targets.map((target) => path.basename(target.output, ".js"))),
  );

  return targets;
}

/**
 * Only write when the content changed, to avoid triggering recompilation.
 *
 * @param {string} file
 * @param {string} content
 */
function writeIfChanged(file, content) {
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (existing !== content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
}

/**
 * @param {Project} project
 * @returns {string}
 */
function elmJson(project) {
  return `${JSON.stringify(
    {
      type: "application",
      "source-directories": ["src"],
      "elm-version": "0.19.1",
      dependencies: {
        direct: sortKeys({
          "elm/browser": "1.0.2",
          "elm/core": "1.0.5",
          "elm/html": "1.0.0",
          ...project.direct,
        }),
        indirect: sortKeys({
          "elm/json": "1.1.3",
          "elm/time": "1.0.0",
          "elm/url": "1.0.0",
          "elm/virtual-dom": "1.0.3",
          ...project.indirect,
        }),
      },
      "test-dependencies": { direct: {}, indirect: {} },
    },
    null,
    4,
  )}\n`;
}

/**
 * @param {Record<string, string>} record
 * @returns {Record<string, string>}
 */
function sortKeys(record) {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * @param {string} projectName
 * @param {number} size
 * @returns {string}
 */
function bigModule(projectName, size) {
  const functions = Array.from(
    { length: size },
    (_, i) => `
f${i} : Int -> Item
f${i} n =
    { id = n + ${i}
    , label = "${projectName} ${i}: " ++ String.fromInt (n * ${i})
    , tags = List.map (\\tag -> tag ++ "${i}") [ "a", "b" ]
    }
`,
  );
  return `module Big exposing (all)


type alias Item =
    { id : Int
    , label : String
    , tags : List String
    }

${functions.join("\n")}

all : List (Int -> Item)
all =
    [ ${Array.from({ length: size }, (_, i) => `f${i}`).join("\n    , ")}
    ]
`;
}

/**
 * @param {string} moduleName
 * @param {string} title
 * @param {number} size
 * @returns {string}
 */
function mainModule(moduleName, title, size) {
  const count =
    size === 0
      ? `"0"`
      : `String.fromInt (List.length (List.map (\\f -> f 1) Big.all))`;
  return `module ${moduleName} exposing (main)

${size === 0 ? "" : "import Big\n"}import Html


main : Html.Html msg
main =
    Html.p [] [ Html.text ("${title}: " ++ ${count} ++ " functions") ]
`;
}

/**
 * @param {Array<string>} names
 * @returns {string}
 */
function page(names) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated</title>
  </head>
  <body>
    <h1>Generated targets</h1>
${names
  .map(
    (name) => `    <div id="${name}"></div>
    <script src="/build/${GENERATED_DIR}/${name}.js"></script>
    <script>
      Elm.${name}.init({ node: document.getElementById("${name}") });
    </script>`,
  )
  .join("\n")}
  </body>
</html>
`;
}
