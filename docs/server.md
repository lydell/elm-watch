---
title: Server
nav_order: 10
---

# Server

{: .warning }  
⚠️ This is a beta feature! You need to install `elm-watch@beta` to be able to use it.

If you want, you can enable a simple static file server for your project, by adding the following to your `elm-watch.json` file:

```json
"serve": "./folder/you/want/to/serve/"
```

For example:

```json
"serve": "./public/"
```

{: .info }  
ℹ️ By default, the HTTP server is exposed on the local network (so you can test on your phone on the same Wi-Fi for example). If you are on a public Wi-Fi, you can restrict the server to just your computer by setting an environment variable: `ELM_WATCH_HOST=127.0.0.1`. Otherwise, you could expose the source code of your project if you use `"serve": "."`.

## What does the simple static file server do?

- Serves files in a directory.
- Serves the closest [index.html](#indexhtml) file if the URL does not point to any file, for `Browser.application` programs.
- Hot reloads CSS – when `.css` files in the static files directory that is served change, elm-watch reloads them in the browser.

## Why?

1. First and foremost, elm-watch needs an HTTP server for its WebSockets. WebSockets connect via HTTP and then switch over to the WebSocket protocol. So elm-watch has to run an HTTP server anyway.

2. You _need_ an HTTP server for using [Browser.application](#browserapplication) programs. elm-watch has an HTTP server running anyway, so why not use it to serve files for your `Browser.application`?

3. CSS hot reloading: Elm does not offer a definitive styling answer. CSS can be a pretty nice language, and due to its stateless nature it’s very easy to hot reload. It’s a small, fully reliable and configuration free feature.

4. Already being a replacement for `elm make`, this makes elm-watch a more flexible replacement for `elm reactor` as well.

## What it won’t do

Here are some things elm-watch’s simple HTTP server _won’t_ do, by design:

- Routing.
- Proxying API requests. TODO: Create example.
- HTML templating.
- On-the-fly compilation of CSS and TypeScript.

The configuration is `"serve": "./directory/"` rather than `"serve": { "directory": "./directory/" }` on purpose to not allow for more options.

Just like mentioned in [What elm-watch is _not_](../what-elm-watch-is-not), I don’t want to drown in feature requests for the HTTP server. I want to focus on the Elm aspects. On top of that, I personally think it’s easier and more flexible to write your own little dev server once you need more advanced things. Easier in the form of that you can write plain code instead of reading documentation, and that you can debug why things are not working easily. More flexible since with custom code you can do anything, not just what is supported through configuration.

So elm-watch’s simple static server focuses on the needs of [Browser.application](#browserapplication). Anything more is outside the scope of Elm and requires a custom solution.

See the [example/] folder for inspiration on how to make your own dev server.

Remember that elm-watch’s HTTP server does _not_ provide any magic for hot reloading of Elm files to work or anything like that. It just serves files. So if you serve your files some other way, that’s totally fine. As long as the generated Elm JS can connect via WebSocket to elm-watch hot reloading works fine.

## index.html

This section is about:

- How to deal with files not found
- How index.html files work

Those two things are closely related!

There’s an old convention in static file servers that when the URL points to a _directory,_ the server looks for an `index.html` file in that directory and serves that.

_Single page applications_ (which `Browser.applications` programs are) brings another convention: Serving the same HTML files for basically all URLs, letting the frontend app handle the URL.

elm-watch’s static file server combines both conventions: Whenever no file can be found for a URL, elm-watch looks for the closest `index.html` and serves it.

For example, let’s say you have `"serve": "./public/"` in `elm-watch.json` and the `public/` directory looks like so:

```
public/
├── index.html
├── main.js
└── admin/
   ├── admin.js
   └── index.html
```

Here are some URLs and what is served:

| URL | File | Comment |
| --- | --- | --- |
| `/` | `public/index.html` | Directory, use `index.html` |
| `/blog/2023/elm-tips` | `public/index.html` | Not such file, use closest `index.html` |
| `/admin` | `public/admin/index.html` | Directory, use `index.html` |
| `/admin/blog/2023/elm-tips` | `public/admin/index.html` | Not such file, use closest `index.html` (`admin/index.html` is closer this time) |
| `/main.js` | `public/main.js` | File exists, serve it |
| `/admin/admin.js` | `public/admin/admin.js` | File exists, serve it |
| `/mani.js` (typo) | `public/index.html` | (!) No such file, serve closest `index.html` |
| `/admin/amdin.js` (typo) | `public/admin/index.html` | (!) No such file, serve closest `index.html` |

As you can see, the `index.html` conventions lets you have one `Browser.application` program which deals with URLs starting with `/admin` and another `Browser.application` program that deals with all other URLs.

But it also has the side effect of _never getting 404s anymore._ In the two URLs above with typos (which were meant to go to files), you instead got HTML files served. This means that you _can’t look for 404 in the browser devtools Network panel._ There won’t be any 404 requests. Just 200 OK ones with HTML responses.

If you inspect the request for `/main.js`, you can see that elm-watch added some extra response headers to it:

- `elm-watch-404: /Users/you/project/public/mani.js`. This header hints that the URL was actually a 404, and shows the absolute file path that couldn’t be found.
- `elm-watch-index-html: /Users/you/project/public/index.html`. Shows the `index.html` file that was served instead.
- `elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml`. A handy link to this page if you need to read up on the details.

elm-watch also adds an HTML comment with `<!-- elm-watch debug information: -->` at the top of the served HTML, which contains the same information as the headers but with more words. The idea is that the headers and the HTML comment should help you when a file path didn’t work.

Here’s a tip for fixing a broken URL to a file:

1. Copy the absolute file path that actually was tried to be read from the `elm-watch-404` header or the HTML comment (or an actual 404 page if there was no closest `index.html`).

2. Open the file you intended to link to in your editor or in a file explorer and copy its absolute path.

3. Paste them next to each other, like so:

   ```
   /Users/you/project/public/mani.js
   /Users/you/project/public/main.js
   ```

4. Compare them to spot differences. Update the URL, or rename or move the file.

Note that `index.html` files must be called exactly `index.html`. Not `index.htm` or `INDEX.HTML`.

What would happen if you named `public/admin/index.html` just `public/admin.html` instead? There’s nothing stopping you from doing it. You would need to go to `/admin.html` to access it. Which would probably render a 404-style page in your `Browser.application` program, since you most likely have no route matching `/admin.html`. And if the `Browser.application` program ever changes the URL, refreshing the page won’t work. So stick to `index.html` files for `Browser.application` programs.

I recommend always creating an `index.html` directly in your static files directory. elm-watch prints a link to the static file server on start up, and if you have a root `index.html` file, that link will take you somewhere useful from the get go.

## Browser.application

`Browser.application` programs can change the URL and has some things to note:

- It _requires_ an HTTP server. (The `file://` protocol is not supported by `Browser.application`, so you can’t just double-click the HTML file to open it in a browser. That’s why getting a simple static server from elm-watch is very convenient.)
- The HTTP server you use needs to be smart to handle page reloads. That’s why elm-watch has its [index.html](#indexhtml) conventions.

**Note:** elm-watch’s server is _not_ for production use. If you want to deploy your app somewhere, use any file server of choice. Make sure to set it up to handle serving your HTML file so that reloading the page works.

[example/]: https://github.com/lydell/elm-watch/tree/main/example#readme
