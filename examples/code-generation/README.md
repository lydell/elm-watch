# elm-watch code generation example

This example generates Elm code from [translations.json](./translations.json): A `Translations` module with a `Language` custom type and a record of translated strings per language. That way, the Elm compiler makes sure that you only use translations that exist.

Since [elm-watch.mjs](./elm-watch.mjs) is just a Node.js script, it can do things before starting elm-watch – and while elm-watch is running:

- It generates `generated/Translations.elm` before starting elm-watch. (`generated/` is listed in `"source-directories"` in [elm.json](./elm.json), and is gitignored.)
- In hot mode, it watches `translations.json` and regenerates `Translations.elm` when it changes. elm-watch notices that an Elm file changed, recompiles and hot reloads.
- If generation fails (for example, if a language is missing a translation), the previous `Translations.elm` is left as-is, and the error is passed to elm-watch with an [error reporter](https://lydell.github.io/elm-watch/javascript-api/#showing-errors-from-other-tools). elm-watch shows it like any other error, both in the terminal and in the browser. That way, there’s no need to print to the terminal, which would mess up elm-watch’s output. In make mode, the error makes the build fail.

Compare with the [asset paths example](../asset-paths/), which restarts the whole script with `node --watch-path` instead of watching a file itself.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `translations.json` and watch the browser be automatically updated. Try adding a key for only one of the languages, to see an error.
4. Edit `src/Main.elm` or `style.css` and watch the browser be automatically updated.
5. Stop elm-watch.
6. Run `node --run build` (which runs `node elm-watch.mjs make --optimize`) to build for production.
7. Double-click `index.html` to open it straight in a browser to try out the production build.
