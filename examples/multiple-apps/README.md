# elm-watch multiple apps example

This example has two Elm apps, which share some code:

- [Main](./src/Main.elm) – a `Browser.application` that owns all URLs except the ones starting with `/admin`.
- [Admin](./src/Admin.elm) – a `Browser.application` that owns `/admin` and all URLs below it.
- [Shared](./src/Shared.elm) – navigation and layout used by both.

Each app is a target in [elm-watch.json](./elm-watch.json), and has its own `index.html`:

```
public/
├── index.html         <- loads /build/main.js
├── style.css
└── admin/
   └── index.html      <- loads /build/admin.js
```

elm-watch’s static file server serves the [closest index.html](https://lydell.github.io/elm-watch/server/#indexhtml) for URLs that aren’t files. So `/about` gets `public/index.html` (the main app), and `/admin/users` gets `public/admin/index.html` (the admin app). Reloading the page works on any URL. elm-watch only compiles the apps you have open in the browser, and prioritizes the ones you are looking at.

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` (which runs `elm-watch hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server. Open it in a browser.
3. Click around between the main app and the admin app. Try reloading the page.
4. Edit `src/Shared.elm` and watch both apps be automatically updated (try having both open in different tabs).
5. Stop elm-watch.
6. Run `npm run build` (which runs `elm-watch make --optimize`) to build for production. In production, configure your web server to serve `public/admin/index.html` for URLs starting with `/admin`, and `public/index.html` for other URLs.
