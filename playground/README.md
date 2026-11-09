# elm-watch playground

This is a playground for developing elm-watch itself. It has Elm programs of all kinds, and pages that try out special cases. It is not meant as an example to learn from – see the [examples] for that.

## How to run

1. `cd` to the _repository root_ (not this folder). We need to start there because the playground uses a locally built elm-watch instead of a pre-built elm-watch from npm.
2. Run `npm ci` to install dependencies for building elm-watch.
3. Run `npm run build` to build elm-watch.
4. Run `cd playground` to go into this folder.
5. Run `npm ci` to install dependencies for the playground.
6. Run `npm start` (which runs `node --watch elm-watch.mjs hot`). Or run `npm run dev` to build elm-watch first.
7. Open the link that elm-watch prints. The index page links to all the pages.
8. Edit an Elm file in `src/` and watch the browser be automatically updated.

You can also enable only some targets: `node elm-watch.mjs hot Html Sandbox`.

[examples]: https://github.com/lydell/elm-watch/tree/main/examples#readme
