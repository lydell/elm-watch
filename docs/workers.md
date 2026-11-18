# Workers

> [!IMPORTANT]
> These are the old docs for elm-watch 1.x (and early `elm-watch@beta` versions). See the [current docs](https://lydell.github.io/elm-watch/).

Elm has [Platform.worker] programs – programs without `view`. They are sometimes used in Web Workers or in Node.js.

elm-watch works in both Web Workers and Node.js. The biggest difference compared to running in a web page, is that you don’t get the [Browser UI](browser-ui.md). Instead, elm-watch only logs to the console. (There is currently no UI to switch to optimize mode (worker programs don’t have a debug mode).)

Another important difference, is that outside a web page there is no concept of “reloading the page”. Sometimes it is not possible to hot reload an Elm app, such as when adding a new port. Then the whole application needs to be reloaded. In a web page, elm-watch automatically reloads the page. In a Web Worker or Node.js, elm-watch can’t do that. Instead, elm-watch logs a message about this, and you need to restart your program yourself. Luckily, there is a way you can improve this experience.

You can define `globalThis.ELM_WATCH_FULL_RELOAD` to be a function that does a “full reload”:

```js
globalThis.ELM_WATCH_FULL_RELOAD = () => {
  // Do whatever you need to restart your application here.
};
```

For an example of how to do this in Node.js, see [example/nodejs-program.js]. It’s not particularly easy, but it is possible!

Note that you need a recent enough Node.js version that supports the `WebSocket` global (in short, basically Node.js 22 or later).

[example/nodejs-program.js]: https://github.com/lydell/elm-watch/blob/3bb2599600df0a4e268f57298174e24d37f173ae/example/nodejs-program.js
[platform.worker]: https://package.elm-lang.org/packages/elm/core/latest/Platform#worker
