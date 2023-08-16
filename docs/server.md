---
title: Server
nav_order: 10
---

# Server

If you want, you can enable a simple static file server for your project, by adding the following to your `elm-watch.json` file:

```json
"serve": "./folder/you/want/to/serve/"
```

For example:

```json
"serve": "./public/"
```

{: .info }  
ℹ️ By default, the HTTP server is exposed on the local network (so you can test on your phone on the same Wi-Fi for example). If you are on a public Wi-Fi, you can restrict the server to just your computer by setting an environment variable: `ELM_WATCH_HOST=127.0.0.1`. Note that if you use `"serve": "."` you are exposing the source code of your project.

## What does the simple static file server do?

- Serves files in a directory.
- Lets you browse directory contents (add `/?` the end of the URL).
- Hot reloads CSS – when `.css` files in the static files directory that is served changes, elm-watch reloads them in the browser.

## Why?

1. First and foremost, elm-watch needs an HTTP server for its WebSockets. WebSockets connect via HTTP and then switch over to the WebSocket protocol.

2. You _need_ an HTTP server for using [Browser.application](#browserapplication) programs. elm-watch has an HTTP server running anyway, so why not use to serve files for your `Browser.application`?

3. CSS hot reloading: Elm does not offer a definitive styling answer. CSS can be a pretty nice language, and due to its stateless nature it’s very easy to hot reload. It’s a small, fully reliable and configuration free feature.

## What it won’t do

Here are some things elm-watch’s simple HTTP server _won’t_ do, by design:

- Routing.
- Proxying API requests.
- HTML templating.
- On-the-fly compilation of CSS and TypeScript.

The configuration is `"serve": "./directory/"` rather than `"serve": { "directory": "./directory/" }` on purpose to not allow for more options.

Just like mentioned in [What elm-watch is _not_](../what-elm-watch-is-not), I don’t want to drown in feature requests for the HTTP server. I want to focus on the Elm aspects. On top of that, I personally think it’s easier and more flexible to write your own little dev server once you need more advanced things. Easier in the form of that you can write plain code instead of reading documentation, and that you can debug why things are not working easily. More flexible since with custom code you can do anything, not just what is supported through configuration.

So elm-watch’s simple static server focuses on the needs of [Browser.application](#browserapplication). Anything more is outside the scope of Elm and requires a custom solution.

See the [example/] folder for inspiration on how to make your own dev server.

Remember that elm-watch’s HTTP server does _not_ provide any magic for hot reloading to work or anything like that. It just serves files. So if you serve your files some other way, that’s totally fine. As long as the generated Elm JS can connect via WebSocket to elm-watch hot reloading works fine.

## Browser.application

`Browser.application` programs can change the URL and has some things to note:

- It _requires_ an HTTP server. (The `file://` protocol is not supported by `Browser.application`, so you can’t just double-click the HTML file to open it in a browser. That’s why getting a simple static server from elm-watch is very convenient.)
- The HTTP server you use needs to be smart to handle page reloads. Read on below to see how elm-watch’s server handles that.

Let’s say you open `index.html` using elm-watch’s server. You click around in your app, and it changes the URL to `/blog`. That works fine! But what happens when you try to refresh the page? You probably have no file called `blog`, so you’ll get a 404. Luckily, elm-watch remembers the last served HTML file and offers you – right in the 404 page – to save the URL to the HTML page in a cookie. Once you’ve ticked the checkbox for that, you can refresh away all you want and things will just work.

If you want to delete that cookie and go back to getting 404s, add `/?` at the end of the URL. URLs ending with `/?` are excluded from the HTML file fallback feature, letting you toggle the checkbox (or just browse files in folders).

Finally, a little hack you might find interesting. What if you have _two_ `Browser.application` programs, with different HTML files? In Firefox and Chrome, you can use subdomains for `localhost`, which each get their own cookies. So you could run one app on just `http://localhost` and another on `http://my-other-app.localhost`. However, this does not work in Safari or when using an IP address such as `http://192.168.0.100`. Either way, once you’ve got more than one app you might want to consider using your own dev server as mentioned in the previous section.

**Note:** elm-watch’s server is _not_ for production use. If you want to deploy your app somewhere, use any file server of choice. Make sure to set it up to handle serving your HTML file so that reloading the page works.

[example/]: https://github.com/lydell/elm-watch/tree/main/example#readme
