# elm-watch ESM example

This example turns the compiled Elm code into an ECMAScript module (ESM), so that it can be imported with `import Elm from "./build/main.js"` – using the browser’s native `import`, without any bundler.

Elm’s output is a _script_ which sets `this.Elm`, not a _module_ (see [window.Elm](https://lydell.github.io/elm-watch/window.Elm/) for details). The [postprocess](https://lydell.github.io/elm-watch/postprocess/) function in [elm-watch.mjs](./elm-watch.mjs) turns it into a module with a one-liner:

```js
const output = {};
(function () {
  ELM_CODE_HERE;
}).call(output);
export default output.Elm;
```

Things to be aware of:

- **Loading performance:** If a script on your page imports a file which imports the compiled Elm code, the browser can’t start downloading the Elm code until it has downloaded the first file and seen the `import`. [index.html](./public/index.html) uses `<link rel="modulepreload">` to start downloading the Elm code right away.
- **Hot reloading** is slower and uses more memory with modules. Browsers never forget a module once it has been loaded, so each hot reload keeps a copy of your compiled Elm code in memory until you reload the page. If that bothers you, you can postprocess into a module only in make mode (`runMode === "make"`), and use a plain script tag (and `window.Elm`) during development. Then you need different HTML in development and production, though.
- [elm-esm] does not work with elm-watch: It replaces a bit too much of the code. Use the one-liner above instead.

See [Running an example](../README.md#running-an-example) first.

1. Run `node --run start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `node --run build` to build for production.
6. Serve `public/` with any static file server to try out the production build, for example `python3 -m http.server --directory public`. (Modules don’t work when opening an HTML file straight in a browser via `file://`.)

[elm-esm]: https://github.com/ChristophP/elm-esm
