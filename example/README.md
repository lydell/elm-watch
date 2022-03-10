# elm-watch example with esbuild

This is an example that uses:

- elm-watch for Elm compilation
- [esbuild] for TypeScript compilation, and for minification
- [UglifyJS] for extra minification (`postprocess.js`)
- A little Node.js dev server for routing and proxying, with no dependencies (`proxy.js`)
- [run-pty] to run the above with just one command
- [elm-tooling] to install Elm and elm-format

1. Run `git submodule update --init` to fetch some real-world Elm apps for demoing.
2. Run `npm ci` to install.
3. Run `npm start` to start elm-watch, esbuild and the Node.js dev server for development, using run-pty. Alternativley, run `npm start-advanced` for some extra run-pty goodness (see `run-pty.json` if you’re interested).
4. Visit some Elm app in the browser (see below): Go to http://localhost:8000 or http://localhost:9000.
5. Edit an Elm file in `src/` or `public/submodules/` and watch the browser be automatically updated.
6. Stop elm-watch, esbuild and the dev server.
7. Run `npm run build` to build for production, using elm-watch and esbuild.

This example has many Elm apps (many targets in `elm-watch.json`):

- Some simpler demo/test apps in `src/` just need an HTML file served to work. Visit http://localhost:9000 – which is just esbuild’s static file server – to get links to them.
- There are also some real world apps in `public/submodules/`. They use `Browser.application`, so they need a proper server to work fully – that’s where `proxy.js` comes into play. Visit http://localhost:8000 to get links to them.

See [example.yml] for an example GitHub Actions workflow.

See also the [minimal elm-watch example][example-minimal].

[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli
[example-minimal]: https://github.com/lydell/elm-watch/tree/main/example-minimal
[example.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/example.yml
[run-pty]: https://github.com/lydell/run-pty/
[uglifyjs]: https://github.com/mishoo/UglifyJS
