# elm-watch and esbuild side by side example

This example uses [esbuild] to compile TypeScript and bundle npm packages, by running esbuild _next to_ elm-watch. It’s a simple and robust setup: Each tool does its own thing, and prints its own errors in the terminal.

- elm-watch compiles Elm to `public/build/main.js`, hot reloads Elm and CSS, and serves `public/` ([elm-watch.json](./elm-watch.json)).
- esbuild compiles [ts/main.ts](./ts/main.ts) (which uses the [js-confetti] npm package) to `public/build/app.js`. elm-watch serves that file too.
- `tsc --watch` type checks the TypeScript code. esbuild only removes the types, without checking them. In a project with not much TypeScript, you might find that your editor showing type errors (plus running `tsc` on CI) is enough, and skip `tsc --watch`.
- [run-pty] runs all three with one command, with a tab for each.
- [index.html](./public/index.html) loads the compiled Elm code and the compiled TypeScript code in separate script tags (see [window.Elm](https://lydell.github.io/elm-watch/window.Elm/)). It also listens for the `elm-watch:changed-file-url-paths` event to reload the page when esbuild has rebuilt `app.js` (see [Reacting to changed files](https://lydell.github.io/elm-watch/server/#reacting-to-changed-files)).

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` to start elm-watch, esbuild and tsc for development, using [run-pty].
2. Select elm-watch in run-pty. It prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
4. Edit `ts/main.ts` and watch the page reload. If you make a syntax error, esbuild removes `app.js`, so the page goes blank until you fix it. See the esbuild tab in run-pty for the error. Type errors are shown in the tsc tab.
5. Stop elm-watch, esbuild and tsc.
6. Run `npm run build` to build for production: elm-watch in `--optimize` mode, followed by esbuild for both bundling and minifying the TypeScript code, and for minifying the Elm code. (Note: `package.json` has no `"type": "module"` on purpose. With it, esbuild would treat the compiled Elm code as a module when minifying it, where top-level `this` is `undefined`, and `window.Elm` would not be created.)
7. Run `npx esbuild --servedir=public` to try out the production build. (Note: This command is for trying out the production build locally, not something you’d actually run in production to serve the files.)

[esbuild]: https://esbuild.github.io/
[js-confetti]: https://github.com/loonywizard/js-confetti
[run-pty]: https://github.com/lydell/run-pty/
