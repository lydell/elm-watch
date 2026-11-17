# Minimal elm-watch example

This is a minimal example of how to use elm-watch: An [elm-watch.json](./elm-watch.json) file, and an [index.html](./index.html) file that loads the compiled Elm code. `"serve": "."` in `elm-watch.json` enables elm-watch’s [static file server](https://lydell.github.io/elm-watch/server/), so you don’t need a server of your own. It also gives you CSS hot reloading, and supports `Browser.application`.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `elm-watch hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `style.css` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `node --run build` (which runs `elm-watch make --optimize`) to build for production. Since this is a minimal example, there’s no minification, just Elm’s `--optimize` mode.
6. Double-click `index.html` to open it straight in a browser to try out the production build.
