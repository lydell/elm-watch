# elm-watch and Vite side by side example

This is the same app as in the [Vite in process example](../vite-in-process/), but Vite and elm-watch run as two separate commands, side by side, using [run-pty]. Each tool runs its own server and prints its own output in the terminal, without any code connecting them.

- elm-watch compiles Elm to `public/build/main.js`, and serves it on port 8001 ([elm-watch.json](./elm-watch.json)).
- Vite serves everything else on its usual port 5173: [index.html](./index.html), [ts/main.ts](./ts/main.ts) (which uses the [js-confetti] npm package) and [ts/style.css](./ts/style.css). Vite hot reloads CSS and shows TypeScript syntax errors in the browser.
- `index.html` loads the compiled Elm code with a plain script tag, straight from elm-watch’s server: `<script src="%VITE_ELM_WATCH_ORIGIN%/build/main.js">`. During development, `VITE_ELM_WATCH_ORIGIN` is `http://localhost:8001` (see [.env.development](./.env.development)). That way, Vite never touches the compiled Elm code (it would inject code into it otherwise), and elm-watch can wait for compilation to finish if needed. In production, `VITE_ELM_WATCH_ORIGIN` is empty (see [.env.production](./.env.production)), so the URL becomes just `/build/main.js`. The file is in `public/`, which Vite copies as-is when building for production.
- elm-watch’s WebSocket accepts connections from pages on any `localhost` port, so hot reloading Elm works even though the page is served by Vite.

Trade-offs compared to the [Vite in process example](../vite-in-process/):

- 👍 No code needed to connect the two – just configuration.
- 👍 Vite can print to the terminal as usual.
- 👎 Two commands to run (but run-pty makes that easy).
- 👎 Two ports, and the elm-watch port is hard coded in two places. `localhost` is also hard coded, so testing on your phone requires some changes.
- 👎 No minification of the Elm code, since that requires a [postprocess](https://lydell.github.io/elm-watch/postprocess/) function, which in turn requires the [JavaScript API](https://lydell.github.io/elm-watch/javascript-api/). Vite does not touch the Elm code. See the [production example](../production/) for how to do it.

There’s no type checking during development – Vite only removes the types. In a project with not much TypeScript, your editor showing type errors is often enough. Run `node --run check` (which runs `tsc`) before committing, and on CI.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` to start elm-watch and Vite for development, using [run-pty].
2. Select Vite in run-pty. Open the link it prints in a browser.
3. Edit `src/Main.elm` or `ts/style.css` and watch the browser be automatically updated.
4. Edit `ts/main.ts` and watch the page reload. Try making a syntax error, and see it in the browser.
5. Stop elm-watch and Vite.
6. Run `node --run build` to build for production: elm-watch in `--optimize` mode, followed by `vite build`.
7. Run `npx vite preview` to try out the production build.

[js-confetti]: https://github.com/loonywizard/js-confetti
[run-pty]: https://github.com/lydell/run-pty/
