# elm-watch JavaScript API example

This is the [minimal example](../minimal/), but using elm-watch’s [JavaScript API](https://lydell.github.io/elm-watch/javascript-api/) instead of `elm-watch.json`, and with elm-watch’s [static file server](https://lydell.github.io/elm-watch/server/) enabled (which also gives you CSS hot reloading).

[elm-watch.mjs](./elm-watch.mjs) was created by running `elm-watch init --javascript` in a copy of the minimal example, with `"serve": "."` added to its `elm-watch.json`. That command converted `elm-watch.json` into `elm-watch.mjs`, and it has not been changed since. It works just like the `elm-watch` command (including target name filtering and `--debug`/`--optimize`), but now it’s just code that you can change however you like. The other examples build on this.

There’s also `elm-watch init --typescript`, which creates `elm-watch.mts` instead.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch for development. Thanks to [node --watch](https://nodejs.org/api/cli.html#--watch), elm-watch restarts when you edit `elm-watch.mjs`.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `style.css` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `node --run build` (which runs `node elm-watch.mjs make --optimize`) to build for production.
6. Double-click `index.html` to open it straight in a browser to try out the production build.
