# elm-watch HTTPS example

This example serves the page over `https://` instead of `http://`, by giving elm-watch an HTTPS server via the `createServer` option in [elm-watch.mjs](./elm-watch.mjs). See [HTTPS](https://lydell.github.io/elm-watch/https/) in the docs for background.

You usually don’t need HTTPS for local development: browsers treat `http://localhost` as secure. But if you need HTTPS, for example for testing on your phone via the local network with web features that only work on secure pages, this is how.

On `https://` pages, elm-watch’s WebSocket connects with `wss://`. Since elm-watch’s own server is an HTTPS server here, that just works.

[elm-watch.mjs](./elm-watch.mjs) creates a self-signed certificate in `certificate/` with `openssl` the first time you run it. Browsers don’t trust self-signed certificates, so you need to click past a warning the first time you open the page. If you’d rather have a certificate that browsers trust, you can use [mkcert]:

```
mkcert -install
mkcert -key-file certificate/dev.key -cert-file certificate/dev.crt localhost 127.0.0.1
```

(Add your computer’s IP address to the `mkcert` command if you want to test on other devices.)

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch for development.
2. The previous command prints an `https://` link to elm-watch’s server. Open it in a browser, and accept the self-signed certificate.
3. Edit `src/Main.elm` or `public/style.css` and watch the browser be automatically updated.
4. Stop elm-watch.
5. Run `npm run build` (which runs `node elm-watch.mjs make --optimize`) to build for production. `createServer` is only used in hot mode, so no certificate is needed for that.

[mkcert]: https://github.com/FiloSottile/mkcert
