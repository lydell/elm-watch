# elm-watch asset paths example

A common question is how to refer to images and other assets from Elm, without typos in the paths. This example generates an Elm module with one constant per file in `public/assets/`:

```elm
import Assets

Html.img [ Html.Attributes.src Assets.iconsStarFilled ] []
```

```elm
-- generated/Assets.elm
iconsStarFilled : String
iconsStarFilled =
    "/assets/icons/star-filled.svg?v=b91ac90b"
```

- [elm-watch.mjs](./elm-watch.mjs) generates `generated/Assets.elm` before starting elm-watch. (`generated/` is listed in `"source-directories"` in [elm.json](./elm.json), and is gitignored.)
- It finds the assets with [fs.globSync](https://nodejs.org/api/fs.html#fsglobsyncpattern-options), which is built into Node.js.
- The `?v=` part is a hash of the file contents (cache busting). When an image changes, its URL changes, so the browser fetches the new version. That also makes Elm hot reload with the new image during development!
- `node --run start` runs `node --watch-path=elm-watch.mjs --watch-path=public/assets elm-watch.mjs hot`. [--watch-path](https://nodejs.org/api/cli.html#--watch-path) makes Node.js restart the script whenever something in `public/assets/` changes, which regenerates `Assets.elm`. elm-watch restarts gracefully, and the browser reconnects. Note that `--watch-path` turns off the default `--watch` behavior of watching the script and the files it imports, so `--watch-path=elm-watch.mjs` is needed too. If you split the script into several files, add a `--watch-path` for each of them (or for a directory containing them).
- If generation fails (for example, if two files would get the same Elm name), the previous `Assets.elm` is left as-is, and the error is passed to elm-watch with an [error reporter](https://lydell.github.io/elm-watch/javascript-api/#showing-errors-from-other-tools). elm-watch shows it like any other error, both in the terminal and in the browser.

Compare with the [code generation example](../code-generation/), which watches a file itself instead of restarting the whole script. Restarting is simpler, and fine for things that change rarely, like assets.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `public/assets/logo.svg` (for example, change the color) and watch the browser be automatically updated.
4. Add, rename or remove files in `public/assets/`, and see how `generated/Assets.elm` changes.
5. Stop elm-watch.
6. Run `node --run build` (which runs `node elm-watch.mjs make --optimize`) to build for production. Deploy `public/`.
