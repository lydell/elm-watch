# elm-watch with esbuild in the same process example

This is the same app as in the [esbuild side by side example](../esbuild-side-by-side/), but esbuild runs _inside_ [elm-watch.mjs](./elm-watch.mjs), via esbuild’s JavaScript API, instead of as a separate command. One command, one process, no [run-pty] needed.

The catch is the terminal. elm-watch owns it: It clears the screen and moves the cursor around to update its output. If esbuild printed to the terminal too, the two would mess each other up. So in hot mode, esbuild is silent, and esbuild errors are shown in the browser instead:

- esbuild runs in watch mode with `write: false`, and a small plugin writes the files.
- On success, the plugin writes the compiled code to `public/build/app.js`.
- On errors, the plugin writes a script to `public/build/app.js` that displays the errors on the page instead.
- Either way, elm-watch notices that `app.js` changed, and [index.html](./public/index.html) reloads the page (see [Reacting to changed files](https://lydell.github.io/elm-watch/server/#reacting-to-changed-files)).

In make mode, esbuild runs after elm-watch is done, so then it can print to the terminal as usual.

The Elm code is minified with `esbuild.transform` in a [postprocess](https://lydell.github.io/elm-watch/postprocess/) function, in optimize mode.

There’s no type checking during development – esbuild only removes the types. In a project with not much TypeScript, your editor showing type errors is often enough. Run `node --run check` (which runs `tsc`) before committing, and on CI.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch and esbuild for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
4. Edit `ts/main.ts` and watch the page reload. Try making a syntax error, and see it in the browser.
5. Stop elm-watch.
6. Run `node --run build` to build for production.
7. Run `npx esbuild --servedir=public` to try out the production build. (Note: This command is for trying out the production build locally, not something you’d actually run in production to serve the files.)

[run-pty]: https://github.com/lydell/run-pty/
