# elm-watch Browser.application with proxy example

This example shows:

- A [Browser.application](https://lydell.github.io/elm-watch/server/#browserapplication) program, served by elm-watch’s [static file server](https://lydell.github.io/elm-watch/server/). Reloading the page works on any URL, thanks to the [index.html](https://lydell.github.io/elm-watch/server/#indexhtml) conventions.
- Proxying API requests (URLs starting with `/api/`) to a backend, by passing a [custom server](https://lydell.github.io/elm-watch/server/#custom-server) to elm-watch in [elm-watch.mjs](./elm-watch.mjs). No dependencies needed. That way, the Elm app can make requests to the same origin, just like in production.
- Running elm-watch and the backend ([backend.js](./backend.js)) with one command, using [run-pty].

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` to start elm-watch and the backend for development, using [run-pty].
2. Select elm-watch in run-pty. It prints a link to elm-watch’s server. Open it in a browser.
3. Go to the Time page and click the button to make an API request.
4. Reload the page: You should still be on the Time page.
5. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
6. Stop elm-watch and the backend.
7. Run `npm run build` to build for production. In production, you would serve `public/` and route `/api/` to the backend with your production web server.

[run-pty]: https://github.com/lydell/run-pty/
