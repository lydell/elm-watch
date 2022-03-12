# elm-watch example with esbuild

This is an example that uses:

- elm-watch for Elm compilation
- [esbuild] for TypeScript compilation, and for minification
- [UglifyJS] for extra minification (`postprocess.js`)
- A little Node.js dev server for routing and proxying, with no dependencies (`proxy.js`)
- [run-pty] to run the above with just one command
- [elm-tooling] to install Elm and elm-format

1. `cd` to the _repository root_ (not this folder). We need to start there because this example uses a locally built elm-watch instead of a pre-built elm-watch from npm.
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.
4. Run `cd example` to go into this folder.
5. Run `npm ci` to install dependencies for this example.
6. Run `git submodule update --init` to fetch some real-world Elm apps for demoing.
7. Run `npm start` to start elm-watch, esbuild and the Node.js dev server for development, using run-pty. Alternativley, run `npm start-advanced` for some extra run-pty goodness (see `run-pty.json` if you’re interested).
8. Visit some Elm app in the browser (see below): Go to http://localhost:8000 or http://localhost:9000.
9. Edit an Elm file in `src/` or `public/submodules/` and watch the browser be automatically updated.
10. Stop elm-watch, esbuild and the dev server.
11. Run `npm run build` to build for production, using elm-watch and esbuild.
12. Run `npm run start-production` to to try out the production build. It uses esbuild only for serving static files, and the Node.js dev server for proxying. It’s the same URLs as before: http://localhost:8000 and http://localhost:9000. (Note: This command is for trying out the production build locally, not something you’d actually run in production to serve the files.)

This example has many Elm apps (many targets in `elm-watch.json`):

- Some simpler demo/test apps in `src/` just need an HTML file served to work. Visit http://localhost:9000 – which is just esbuild’s static file server – to get links to them.
- There are also some real world apps in `public/submodules/`. They use `Browser.application`, so they need a proper server to work fully – that’s where `proxy.js` comes into play. Visit http://localhost:8000 to get links to them.

See [example.yml] for an example GitHub Actions workflow.

See also the [minimal elm-watch example][example-minimal].

[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli
[esbuild]: https://esbuild.github.io/
[example-minimal]: https://github.com/lydell/elm-watch/tree/main/example-minimal
[example.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/example.yml
[run-pty]: https://github.com/lydell/run-pty/
[uglifyjs]: https://github.com/mishoo/UglifyJS
