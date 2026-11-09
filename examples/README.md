# elm-watch examples

Each folder is a small, standalone project showing one way of using elm-watch.

| Example | What it shows |
| --- | --- |
| [minimal](./minimal/) | The bare minimum: `elm-watch.json` and an HTML file. |
| [javascript-api](./javascript-api/) | elm-watch.mjs (from `elm-watch init --javascript`) instead of `elm-watch.json`. |
| [production](./production/) | Minification with SWC, and content hashes in file names. |
| [application-proxy](./application-proxy/) | `Browser.application`, and proxying `/api/` to a backend via a custom server. |
| [multiple-apps](./multiple-apps/) | Two `Browser.application` programs with shared code, and an `index.html` each. |
| [esbuild-side-by-side](./esbuild-side-by-side/) | TypeScript and npm packages with esbuild (and `tsc --watch`) running next to elm-watch, using run-pty. |
| [esbuild-in-process](./esbuild-in-process/) | The same, but with esbuild’s JavaScript API running inside `elm-watch.mjs`, showing esbuild errors in the browser. |
| [vite-in-process](./vite-in-process/) | TypeScript, CSS and npm packages with Vite’s dev server running inside elm-watch’s server, in `elm-watch.mts`. TypeScript types for Elm with elm-ts-types. |
| [vite-side-by-side](./vite-side-by-side/) | The same, but with Vite and elm-watch running side by side, and the Elm code loaded straight from elm-watch’s server. |
| [esm](./esm/) | Turning the compiled Elm code into an ECMAScript module with a postprocess function. |
| [code-generation](./code-generation/) | Generating an Elm module from JSON in `elm-watch.mjs`, and regenerating it on changes. |
| [nodejs](./nodejs/) | A `Platform.worker` program in Node.js, with hot reloading. |
| [asset-paths](./asset-paths/) | Generating an Elm module with paths to images, restarting with `node --watch-path` when they change. |

## Running an example

The examples use a locally built elm-watch instead of a pre-built elm-watch from npm. So you need to build elm-watch first:

1. `cd` to the _repository root_ (not this folder).
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.

Then, for the example you’re interested in:

1. `cd examples/the-example` to go into its folder.
2. Run `npm ci` to install dependencies for the example.
3. Follow the instructions in the example’s README.

In your own project, you would install elm-watch from npm instead: `npm install --save-dev elm-watch`.

All examples use the [elm] and [elm-format] npm packages to install Elm and elm-format, but you can of course install them in any way you want.

See [examples.yml] for how the examples are built on CI.

[elm]: https://www.npmjs.com/package/elm
[elm-format]: https://www.npmjs.com/package/elm-format
[examples.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/examples.yml
