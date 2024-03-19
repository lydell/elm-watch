# Minimal elm-watch example

This is a minimal example of how to use elm-watch.

> Don’t be intimidated by the number of steps! They include building elm-watch itself, as well as making a production build. Your own project would have fewer steps.

1. `cd` to the _repository root_ (not this folder). We need to start there because this example uses a locally built elm-watch instead of a pre-built elm-watch from npm.
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.
4. Run `cd example-minimal` to go into this folder.
5. Run `npm ci` to install dependencies for this example.
6. Run `npx elm-watch hot` or `npm start` to start elm-watch for development.
7. The previous command prints a link to elm-watch’s server. Open it in a browser.
8. Edit `src/Main.elm` and watch the browser be automatically updated.
9. Stop `elm-watch`.
10. Run `npx elm-watch make --optimize` or `npm run build` to build for production. (Since this is a minimal example, there’s no minification, just Elm’s `--optimize` mode.)
11. Double-click `index.html` to open it straight in a browser to try out the production build.

The example uses [elm-tooling] to install Elm and elm-format, but you can of course install them in any way you want.

See [example-minimal.yml] for an example GitHub Actions workflow.

See also the [elm-watch example with esbuild][example].

[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli
[example-minimal.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/example-minimal.yml
[example]: https://github.com/lydell/elm-watch/tree/main/example#readme
