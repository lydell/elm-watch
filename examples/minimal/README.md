# Minimal elm-watch example

This is a minimal example of how to use elm-watch: An [elm-watch.json](./elm-watch.json) file, and an [index.html](./index.html) file that loads the compiled Elm code. No server needed – just open `index.html` in a browser, and hot reloading works.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `elm-watch hot`) to start elm-watch for development.
2. Double-click `index.html` to open it straight in a browser.
3. Edit `src/Main.elm` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `node --run build` (which runs `elm-watch make --optimize`) to build for production. Since this is a minimal example, there’s no minification, just Elm’s `--optimize` mode.
6. Reload the page in the browser to try out the production build.

If you also want CSS hot reloading, and an HTTP server (needed for `Browser.application`), add `"serve": "."` to `elm-watch.json` and open the link that elm-watch prints instead. See [Server](https://lydell.github.io/elm-watch/server/). The [javascript-api](../javascript-api/) example does that.
