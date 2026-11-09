# elm-watch playground

This is a playground for developing elm-watch itself. It has many Elm apps of all kinds, including some real-world apps (as git submodules), and is used for trying things out. It is not meant as an example to learn from – see the [examples] for that.

It uses:

- elm-watch for Elm compilation
- [esbuild] for TypeScript compilation, and for minification
- elm-watch’s [JavaScript API](https://lydell.github.io/elm-watch/javascript-api/) ([elm-watch.mjs](./elm-watch.mjs)), with [SWC] for extra minification ([postprocess.js](./postprocess.js))
- A custom little Node.js dev server for routing and proxying, with no dependencies ([dev-server.js](./dev-server.js))
- [run-pty] to run the above with just one command
- The [elm] and [elm-format] npm packages to install Elm and elm-format

## How to run

1. `cd` to the _repository root_ (not this folder). We need to start there because the playground uses a locally built elm-watch instead of a pre-built elm-watch from npm.
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.
4. Run `cd playground` to go into this folder.
5. Run `git submodule update --init` to fetch some real-world Elm apps for demoing.
6. Run `npm ci` to install dependencies for the playground.
7. Run `npm start` to start elm-watch, esbuild and the Node.js dev server for development, using run-pty. Alternatively, run `npm run start-advanced` for some extra run-pty goodness (see `run-pty.json` if you’re interested).
8. Visit some Elm app in the browser (see below for which apps are available): Go to http://localhost:8000 (which is the custom dev server).
9. Edit an Elm file in `src/` or `public/submodules/` and watch the browser be automatically updated.
10. Stop elm-watch, esbuild and the dev server.
11. Run `npm run build` to build for production, using elm-watch, esbuild and SWC.
12. Run `npm run try-production` to to try out the production build. It uses esbuild only for serving static files, and the Node.js dev server for proxying. It’s the same URL as before: http://localhost:8000. (Note: This command is for trying out the production build locally, not something you’d actually run in production to serve the files.)

The playground has many Elm apps (many targets in `elm-watch.mjs`):

- Some simpler demo/test apps in `src/` just need an HTML file served to work. Visit http://localhost:9000 – which is just esbuild’s static file server – to get links to them. These are useful when developing elm-watch itself but pretty boring as a demo.
- There are also some real world apps in `public/submodules/`. They use `Browser.application`, so they need a proper server to work fully – that’s where `dev-server.js` comes into play. Visit http://localhost:8000 to get links to them. These are much more fun demo material.

[elm]: https://www.npmjs.com/package/elm
[elm-format]: https://www.npmjs.com/package/elm-format
[esbuild]: https://esbuild.github.io/
[examples]: https://github.com/lydell/elm-watch/tree/main/examples#readme
[run-pty]: https://github.com/lydell/run-pty/
[swc]: https://swc.rs/
