# Minimal elm-watch example

This is a minimal example of how to use elm-watch: An [elm-watch.json](./elm-watch.json) file, and an [index.html](./index.html) file that loads the compiled Elm code. elm-watch’s built-in static file server serves the files.

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` (which runs `elm-watch hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `style.css` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `npm run build` (which runs `elm-watch make --optimize`) to build for production. Since this is a minimal example, there’s no minification, just Elm’s `--optimize` mode.
6. Double-click `index.html` to open it straight in a browser to try out the production build.
