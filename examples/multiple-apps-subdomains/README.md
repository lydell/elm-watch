# elm-watch multiple apps on subdomains example

This is the [multiple apps example](../multiple-apps/), but with each app on its own host instead of its own path:

- [Main](./src/Main.elm) – a `Browser.application` on `localhost` (`example.com` in production).
- [Admin](./src/Admin.elm) – a `Browser.application` on `admin.localhost` (`admin.example.com` in production).
- [Shared](./src/Shared.elm) – navigation and layout used by both.

Use this approach when you can’t make the apps path based. For example, if each app needs to own all URLs (starting at `/`), or if the apps are on different domains in production and you want the same in development. Different hosts are different origins, so cookies, `localStorage` and so on are separate for the two apps, just like in production.

Each site has its own folder in `public/`:

```
public/
├── main/
│  ├── index.html      <- loads /build/main.js
│  └── style.css
└── admin/
   ├── index.html      <- loads /build/admin.js
   └── style.css
```

elm-watch’s static file server serves one folder. [elm-watch.mjs](./elm-watch.mjs) uses a custom server that puts the site’s folder name first in the URL, based on the host of the request, before letting elm-watch’s server do its thing. So `admin.localhost:8000/users` serves `public/admin/users`, which doesn’t exist, so elm-watch serves the [closest index.html](https://lydell.github.io/elm-watch/server/#indexhtml): `public/admin/index.html`.

Any `*.localhost` host goes to your own computer (no need to edit `/etc/hosts`), and elm-watch’s server [allows](https://lydell.github.io/elm-watch/server/#allowed-hosts) them by default. If you want to use other hosts, such as `admin.example.test`, add them to `allowedHosts`.

See [Running an example](../README.md#running-an-example) first.

1. Run `npm start` (which runs `node --watch elm-watch.mjs hot`) to start elm-watch for development.
2. The previous command prints a link to elm-watch’s server (`localhost`). Open it in a browser.
3. Click around between the main app and the admin app. Try reloading the page.
4. Edit `src/Shared.elm` and watch both apps be automatically updated (try having both open in different tabs).
5. Stop elm-watch.
6. Run `npm run build` (which runs `node elm-watch.mjs make --optimize`) to build for production. In production, serve `public/main/` on `example.com` and `public/admin/` on `admin.example.com`, with each folder’s `index.html` for URLs that aren’t files.
