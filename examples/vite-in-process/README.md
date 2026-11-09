# elm-watch with Vite in the same process example

This example uses [Vite] for TypeScript, CSS and npm packages, by running Vite’s dev server _inside_ elm-watch’s server, in [elm-watch.mts](./elm-watch.mts). One command, one process, one port.

- elm-watch compiles Elm to `public/build/main.js`, and serves it.
- Vite serves everything else: [index.html](./index.html), [ts/main.ts](./ts/main.ts) (which uses the [js-confetti] npm package) and [ts/style.css](./ts/style.css). Vite hot reloads CSS and shows TypeScript syntax errors in the browser.
- Vite runs in [middleware mode](https://vite.dev/config/server-options#server-middlewaremode), passed to elm-watch via a [custom server](https://lydell.github.io/elm-watch/server/#custom-server). Requests for `/build/` go to elm-watch and all other requests go to Vite. elm-watch serves the compiled Elm code exactly as is (Vite would inject code into it), and waits for compilation to finish if needed.
- `index.html` loads the compiled Elm code with a plain script tag (see [window.Elm](https://lydell.github.io/elm-watch/window.Elm/)). Vite leaves it alone, and copies `public/` as-is when building for production.
- Vite is silent in the terminal, since elm-watch owns it (elm-watch clears the screen and moves the cursor around to update its output).
- The Elm code is minified with rolldown (which Vite uses for bundling) in a [postprocess](https://lydell.github.io/elm-watch/postprocess/) function, in optimize mode.
- `elm-watch.mts` is TypeScript. Node.js runs it directly, by stripping the types. You can create such a file with `elm-watch init --typescript`.

There’s no type checking during development – Vite only removes the types. In a project with not much TypeScript, your editor showing type errors is often enough. Run `npm run check` (which runs `tsc`) before committing, and on CI.

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` (which runs `node --watch elm-watch.mts hot`) to start elm-watch and Vite for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `ts/style.css` and watch the browser be automatically updated.
4. Edit `ts/main.ts` and watch the page reload. Try making a syntax error, and see it in the browser.
5. Stop elm-watch.
6. Run `npm run build` to build for production: elm-watch in `--optimize` mode, followed by `vite build`.
7. Run `npx vite preview` to try out the production build.

Compare with the [Vite side by side example](../vite-side-by-side/).

[js-confetti]: https://github.com/loonywizard/js-confetti
[vite]: https://vite.dev/
