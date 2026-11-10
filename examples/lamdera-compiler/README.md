# Lamdera compiler example

This is a vanilla Elm app (no Lamdera backend or Lamdera packages), compiled with the [Lamdera compiler][lamdera] instead of `elm`, by setting `"compiler": "lamdera"` in [elm-watch.json](./elm-watch.json).

The Lamdera compiler can compile any Elm app, and comes with improvements to elm/core, elm/browser and elm/virtual-dom. One of them is built-in hot reloading (`Elm.hot`), which elm-watch uses instead of patching the compiled code. The [lamdera] npm package installs the compiler, so `elm` isn’t needed at all.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `elm-watch hot`) to start elm-watch for development.
2. Open the link that elm-watch prints.
3. Click “Increment” a couple of times, and the “About” link.
4. Edit `src/Main.elm` and watch the browser be automatically updated. The count is kept, and the links keep working.
5. Stop elm-watch.
6. Run `node --run build` (which runs `elm-watch make --optimize`) to build for production. In `--optimize` mode there is no `Elm.hot`, and no minification in this example.

[lamdera]: https://www.npmjs.com/package/lamdera
