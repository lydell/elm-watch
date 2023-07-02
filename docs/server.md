---
title: Server
nav_order: 10
---

# Server

elm-watch ships with a simple HTTP server.

Here’s what that HTTP server is used for:

- An HTTP server is needed for a WebSocket connection to be created. This is the primary reason elm-watch has an HTTP server at all. WebSockets start with an HTTP request and then “upgrade” to the WebSocket protocol.
- Since there’s an HTTP server anyway, it could just as well do something useful apart from handling WebSocket connections. So elm-watch implements a very simple static file server, letting you easily get started with your Elm development.

And here are some things it _won’t_ do, by design:

- Proxying API requests.
- Customizing which folder(s) are served. elm-watch serves the whole directory that the `elm-watch.json` file is located in. No more, no less.
- HTML templating.
- On-the-fly compilation of CSS and TypeScript.
- Customizing routing.
- Customizing anything at all. (Except the [port number](../elm-watch.json))

Here’s my stance on it: Just like mentioned in [What elm-watch is _not_](../what-elm-watch-is-not), I don’t want to drown in feature requests for the HTTP server. I want to focus on the Elm aspects. On top of that, I personally think it’s easier and more flexible to write your own little dev server once you need more advanced things. Easier in the form of that you can write plain code instead of reading documentation, and that you can debug why things are not working easily. More flexible since with custom code you can go anything, not just what is supported through configuration.

See the [example/] folder for inspiration on how to make your own dev server.

Remember that elm-watch’s HTTP server does _not_ provide any magic for hot reloading to work or anything like that. It just serves files. So if you serve your files some other way, that’s totally fine. As long as the generated Elm JS can connect via WebSocket to elm-watch hot reloading works fine.

## Browser.application

`Browser.application` programs can change the URL and has some things to note:

- It _requires_ an HTTP server. (The `file://` protocol is not supported by `Browser.application`, so you can’t just double-click the HTML file to open it in a browser. That’s why getting a simple HTTP server from elm-watch is very convenient.)
- The HTTP server you use needs to be smart to handle page reloads. Read on below to see how elm-watch’s server handles that.

Let’s say you open `index.html` using elm-watch’s server. You click around in your app, and it changes the URL to `/blog`. That works fine! But what happens when you (or elm-watch) try to refresh the page? You probably have no file called `blog`, so you’ll get a 404. However, elm-watch remembers the last served HTML file and offers you – right in the 404 page – to save the URL to the HTML page in a cookie. Once you’ve ticked the checkbox for that, you can refresh away all you want and things will just work.

If you want to delete that cookie and go back to getting 404s, add `/?` at the end of the URL. URLs ending with `/?` are excluded from the HTML file fallback feature, letting you toggle the checkbox (or just browse files in folders).

Finally, a little hack you might find interesting. What if you have _two_ `Browser.application` programs, with different HTML files? In Firefox and Chrome, you can use subdomains for `localhost`, which each get their own cookies. So you could run one app on just `http://localhost` and another on `my-other-app.localhost`. However, this does not work in Safari or when using an IP address such as `http://192.168.0.1`. Either way, once you’ve got more than one app you might want to consider using your own dev server as mentioned in the previous section.

[example/]: https://github.com/lydell/elm-watch/tree/main/example#readme
