# elm-watch production build example

This example shows how to make a production build:

- Minify the compiled Elm code with [SWC] in a [postprocess](https://lydell.github.io/elm-watch/postprocess/) function, in `--optimize` mode. SWC does its work on other threads, so it doesn’t block elm-watch.
- After `make` is done, copy everything to `dist/` and add content hashes to file names (like `main.f7225565.js`), so that browsers can cache them forever. This is done after elm-watch is done (rather than in the postprocess function), since it needs to know about all files at once to update `index.html`.

Everything is in [elm-watch.mjs](./elm-watch.mjs).

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
4. Click the elm-watch icon in the browser and switch to optimize mode. Now you’re running the minified code. Switch back to standard mode when you’re done.
5. Stop elm-watch.
6. Run `node --run build` to build for production.
7. Double-click `dist/index.html` to open it straight in a browser to try out the production build.

[swc]: https://swc.rs/
