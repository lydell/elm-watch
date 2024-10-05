# elm-watch example with esbuild

This is an example that uses:

- elm-watch for Elm compilation
- [esbuild] for TypeScript compilation
- [SWC] for minification (`postprocess.js`)
- A little Node.js dev server for routing and proxying, with no dependencies (`dev-server.js`)
- [run-pty] to run the above with just one command
- [elm-tooling] to install Elm and elm-format

See [example.yml] for an example GitHub Actions workflow.

See also the [minimal elm-watch example][example-minimal].

## How to run

> Don’t be intimidated by the number of steps! They include building elm-watch itself, as well as making a production build, and cloning demo submodules. Your own project would have fewer steps.

1. `cd` to the _repository root_ (not this folder). We need to start there because this example uses a locally built elm-watch instead of a pre-built elm-watch from npm.
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.
4. Run `cd example` to go into this folder.
5. Run `git submodule update --init` to fetch some real-world Elm apps for demoing.
6. Run `npm ci` to install dependencies for this example.
7. Run `npm start` to start elm-watch, esbuild and the Node.js dev server for development, using run-pty. Alternatively, run `npm run start-advanced` for some extra run-pty goodness (see `run-pty.json` if you’re interested).
8. Visit some Elm app in the browser (see below): Go to http://localhost:8000 (the dev server, recommended), or http://localhost:9000 (raw esbuild server).
9. Edit an Elm file in `src/` or `public/submodules/` and watch the browser be automatically updated.
10. Stop elm-watch, esbuild and the dev server.
11. Run `npm run build` to build for production, using elm-watch, esbuild and SWC.
12. Run `npm run try-production` to to try out the production build. It uses esbuild only for serving static files, and the Node.js dev server for proxying. It’s the same URLs as before: http://localhost:8000 and http://localhost:9000. (Note: This command is for trying out the production build locally, not something you’d actually run in production to serve the files.)

This example has many Elm apps (many targets in `elm-watch.json`):

- Some simpler demo/test apps in `src/` just need an HTML file served to work. Visit http://localhost:9000 – which is just esbuild’s static file server – to get links to them. These are useful when developing elm-watch itself but pretty boring as a demo.
- There are also some real world apps in `public/submodules/`. They use `Browser.application`, so they need a proper server to work fully – that’s where `dev-server.js` comes into play. Visit http://localhost:8000 to get links to them. These are much more fun demo material.

[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli
[esbuild]: https://esbuild.github.io/
[example-minimal]: https://github.com/lydell/elm-watch/tree/main/example-minimal#readme
[example.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/example.yml
[run-pty]: https://github.com/lydell/run-pty/
[swc]: https://swc.rs/
