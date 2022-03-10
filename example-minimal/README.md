# Minimal elm-watch example

This is a minimal example of how to use elm-watch.

1. Run `npm ci` to install.
2. Run `npx elm-watch hot` or `npm start` to start elm-watch for development.
3. Open `index.html` in the browser.
4. Edit `src/Main.elm` and watch the browser be automatically updated.
5. Stop `elm-watch`.
6. Run `npx elm-watch make --optimize` or `npm run build` to build for production. (Since this is a minimal example, there’s no minification, just Elm’s `--optimize` mode.)
7. Refresh `index.html` to try it out.

The example uses [elm-tooling] to install Elm and elm-format, but you can of course install them in any way.

See [example-minimal.yml] for an example GitHub Actions workflow.

See also the [elm-watch example with esbuild][example].

[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli
[example-minimal.yml]: https://github.com/lydell/elm-watch/blob/main/.github/workflows/example-minimal.yml
[example]: https://github.com/lydell/elm-watch/tree/main/example
