# elm-watch Node.js example

This example runs a [Platform.worker](https://package.elm-lang.org/packages/elm/core/latest/Platform#worker) program in Node.js, with hot reloading. See [Workers](https://lydell.github.io/elm-watch/workers/) for background.

- [src/Main.elm](./src/Main.elm) is a worker program that receives messages from JavaScript via a port, and replies via another port.
- [program.js](./program.js) runs the compiled Elm code, reads lines from stdin, sends them to Elm and prints the replies.
- elm-watch compiles the Elm code ([elm-watch.json](./elm-watch.json)). The compiled code connects to elm-watch via WebSocket (just like in a browser), so hot reloading works in Node.js too. (Requires Node.js 22 or later, for the `WebSocket` global.)
- Some changes, such as adding a `Cmd` to `init`, can’t be hot reloaded. In a browser, elm-watch reloads the page then. In Node.js, elm-watch calls `globalThis.ELM_WATCH_FULL_RELOAD` instead, if defined. `program.js` defines it to touch itself, which makes [node --watch](https://nodejs.org/api/cli.html#--watch) restart the program.
- `program.js` reads the compiled Elm code with `fs.readFileSync` and runs it with `new Function`, instead of `import`ing it. Otherwise, `node --watch` would restart the whole program whenever the compiled Elm code changes, and hot reloading would never be used.
- [run-pty] runs elm-watch and the program with one command.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` to start elm-watch and the program for development, using [run-pty].
2. Select the program in run-pty. Type something and press Enter.
3. Edit `src/Main.elm` (for example, change `String.toUpper` to `String.toLower`). Type something and press Enter again. Notice how the count continues – the program was hot reloaded, not restarted.
4. Make a change that requires a full reload, such as replacing `Cmd.none` in `init` with `toJs ( "Hello from init", 0 )`. See the program restart.
5. Stop elm-watch and the program.
6. Run `node --run build` (which runs `elm-watch make --optimize`) to build for production.
7. Run `node program.js` to try out the production build.

[run-pty]: https://github.com/lydell/run-pty/
