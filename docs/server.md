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

The simple static file server tries to be useful by default through strong conventions, and extensible enough for more advanced use cases, while still being light weight.

The file server is completely optional. It only serves files. So if you serve your files some other way, that’s totally fine. As long as the generated Elm JS can connect via WebSocket to elm-watch, then Elm hot reloading will work fine.

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

## What you can do yourself

Here are some more advanced dev server needs, that elm-watch simple HTTP server doesn’t do out of the box, but that you can set up yourself:

- Routing.
- Proxying API requests. TODO: Create example.
- HTML templating.
- On-the-fly compilation of CSS and TypeScript.
- HTTPS.

You can always create your own little proxy server in front of elm-watch, using whatever technology you prefer.

But there is also another way: [Running elm-watch in an alternative way with a custom server](#custom-server).

The configuration is `"serve": "./directory/"` rather than `"serve": { "directory": "./directory/" }` on purpose to not allow for more options.

Just like mentioned in [What elm-watch is _not_](../what-elm-watch-is-not), I don’t want to drown in feature requests for the HTTP server. I want to focus on the Elm aspects. On top of that, I personally think it’s easier and more flexible to write a little bit of code when you need more advanced things. Easier in the form of that you can write plain code instead of reading documentation, and that you can debug why things are not working easily. More flexible since with custom code you can do anything, not just what is supported through configuration.

So elm-watch’s simple static server focuses on the needs of [Browser.application](#browserapplication). Anything more is outside the scope of Elm and requires [custom code](#custom-server).

## index.html

This section is about:

- How to deal with files not found
- How index.html files work

Those two things are closely related!

**TL;DR**

- elm-watch serves the closest index.html file (if any) when the URL is not found, for `Browser.application`.
- And it then attaches some debug information to help you when you actually 404:ed.
- Prefer linking to scripts, styles and images with URLs starting with a `/` so they work on any page.

There’s an old convention in static file servers that when the URL points to a _directory,_ the server looks for an `index.html` file in that directory and serves that.

_Single page applications_ (which `Browser.application` programs are) brings another convention: Serving the same HTML files for basically all URLs, letting the frontend app handle the URL.

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

Note how there are two `index.html` files!

Here are some URLs and what is served:

| URL | File | Comment |
| --- | --- | --- |
| `/` | `public/index.html` | Directory, use `index.html` |
| `/blog/2023/elm-tips` | `public/index.html` | No such file, use closest `index.html` |
| `/admin` | `public/admin/index.html` | Directory, use `index.html` |
| `/admin/blog/2023/elm-tips` | `public/admin/index.html` | No such file, use closest `index.html` |
| `/main.js` | `public/main.js` | File exists, serve it |
| `/admin/admin.js` | `public/admin/admin.js` | File exists, serve it |
| `/mani.js` (typo) | `public/index.html` | (!) No such file, serve closest `index.html` |
| `/admin/amdin.js` (typo) | `public/admin/index.html` | (!) No such file, serve closest `index.html` |

As you can see, the `index.html` conventions lets you have one `Browser.application` program which deals with URLs starting with `/admin` and another `Browser.application` program that deals with all other URLs.

But it also has the side effect of _never getting 404s anymore._ In the two URLs above with typos (which were meant to go to files), you instead got HTML files served. This means that you _can’t look for 404 in the browser devtools Network panel._ There won’t be any 404 requests. Just 200 OK ones with HTML responses.

If you inspect the request for `/mani.js` (typo), you can see that elm-watch added some extra response headers to it:

- `elm-watch-404: /Users/you/project/public/mani.js`. This header hints that the URL was actually a 404, and shows the absolute file path that couldn’t be found.
- `elm-watch-index-html: /Users/you/project/public/index.html`. Shows the `index.html` file that was served instead.
- `elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml`. A handy link to this page if you need to read up on the details.

elm-watch also adds an HTML comment starting with `<!-- elm-watch debug information: -->` at the top of the served HTML, which contains the same information as the headers but with more words. The idea is that the headers and the HTML comment should help you when a file path didn’t work.

Here’s a tip for fixing a broken URL to a file:

1. Copy the absolute file path that actually was tried to be read from the `elm-watch-404` header or the HTML comment (or an actual 404 page if there was no closest `index.html`). Paste it in a temporary place.

2. Open the file you intended to link to, using your editor or a file explorer and copy the absolute path of the file. Paste it next to file path in step 1.

3. Compare the two file paths to spot differences:

   ```
   /Users/you/project/public/mani.js
   /Users/you/project/public/main.js
                               ^^
   ```

4. Update the URL, or rename or move the file.

   Beware that relative URLs can be tricky! If you have `<script src="main.js">` it might seem to work at first, when you visit the root (`/`). `main.js` is a relative URL, which also can be written as `./main.js`. If you are on `/` it resolves to `/main.js`. But if your Elm application then changes the URL to `/blog/posts` and you reload the page, the relative URL is now resolving to `/blog/main.js` which probably doesn’t exist!

   When using a static file server, I recommend always starting your URLs with a `/`, like so: `<script src="/main.js">`. Then they work on any page.

Note that `index.html` files must be called exactly `index.html`. Not `index.htm` or `INDEX.HTML`.

What would happen if you named `public/admin/index.html` just `public/admin.html` instead? There’s nothing stopping you from doing it. You would need to go to `/admin.html` to access it. Which would probably render a 404-style page in your `Browser.application` program, since you most likely have no route matching `/admin.html`. And if the `Browser.application` program ever changes the URL, refreshing the page won’t work. So stick to `index.html` files for `Browser.application` programs. Then you get the right page when you Elm app starts, and refreshing the page works.

I recommend always creating an `index.html` directly in your static files directory. elm-watch prints a link to the static file server on start up, and if you have a root `index.html` file, that link will take you somewhere useful from the get go.

## Browser.application

`Browser.application` programs can change the URL and have some things to note:

- They _require_ an HTTP server. (The `file://` protocol is not supported by `Browser.application`, so you can’t just double-click the HTML file to open it in a browser. That’s why getting a simple static server from elm-watch is very convenient.)
- The HTTP server you use needs to be smart to handle page reloads. That’s why elm-watch has its [index.html](#indexhtml) conventions.

**Note:** elm-watch’s server is _not_ for production use. If you want to deploy your app somewhere, use any file server of choice. Make sure to set it up to handle serving your HTML file so that reloading the page works.

## Reacting to changed files

When `.elm` files change, elm-watch automatically compiles to `.js` and hot reloads the application (regardless of whether you use elm-watch’s static file server or not).

When `.css` files inside the directory to serve change, elm-watch automatically hot reloads them.

When other files inside the directory to serve change, elm-watch dispatches a DOM event that you can listen to, if you want to reload for other types of files. You can listen for the event like so:

```js
window.addEventListener("elm-watch:changed-file-url-paths", (event) => {
  // This logs a `Set` of strings. A string can look like this: `"/your/file.js"`.
  // The strings are URL paths and always start with a slash.
  console.log("Just changed file URL paths:", event.detail);
});
```

For example, if you only have a single application you might want to reload the page whenever a JavaScript file, HTML file or image file etc. changes:

```js
window.addEventListener("elm-watch:changed-file-url-paths", () => {
  // Reload the page whenever a non-Elm and non-CSS file inside the directory to
  // be served is changed.
  window.location.reload();
});
```

If you have multiple applications you might want to inspect `event.detail` (which is a set of url paths to changed files) and only reload the page if something related to the current application has changed.

Why doesn’t elm-watch do that by default? elm-watch only reloads when it can be near perfect, so that you can rely on it always working.

- Elm files can be reloaded near perfectly, as described in [Hot reloading](../hot-reloading/).
- CSS is stateless and somewhat easy to reload.
- Images _sound_ like they can be hot reloaded if they change, but it’s very difficult to reload images set by CSS `background-image`, so elm-watch does not reload any images. In practice images don’t change that much during development anyway.
- JS is full of state and can’t be hot reloaded in general. It’s possible to instead reload the page. However, due to `import` and other JS loading techniques it’s difficult to know which JS files should reload which pages. Therefore elm-watch does not reload the page by default, but you can do it yourself as mentioned above, given the constraints of your given project.
- HTML could also be refreshed by reloading the page, but I figured it would be easier to remember how hot reloading works if elm-watch never makes full page reloads (except for a few cases for Elm code that makes a lot of sense).

## Custom server

An alternative way of running for example `elm-watch hot` is:

```
node my-server.mjs
```

```js
// my-server.mjs
import elmWatch from "elm-watch";

elmWatch(["hot"])
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("Unexpected elm-watch error:", error);
  });
```

Instead of hard coding `hot` you can forward all CLI arguments if you want:

```
node my-server.mjs hot
```

```diff
-elmWatch(["hot"])
+elmWatch(process.argv.slice(2))
```

That `elmWatch` function also takes a `createServer` option. Here’s what it looks like if you pass the default for that option in:

```js
import * as http from "node:http";
import elmWatch from "elm-watch";

elmWatch(process.argv.slice(2), {
  createServer: ({ onRequest, onUpgrade }) =>
    http.createServer(onRequest).on("upgrade", onUpgrade),
})
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("Unexpected elm-watch error:", error);
  });
```

- `onRequest` is not strictly needed for the core of elm-watch to work, but is very interesting because it lets you do a lot of stuff. By default, all `onRequest` is doing is responding to regular HTTP requests (WebSocket connection HTTP requests are handled by `onUpgrade`) with a simple HTML page that tells you how to enable elm-watch’s [static file server](../server/). If you enable the static file server, the `onRequest` instead looks for files in the static file directory and serves them. You can wrap `onRequest` to do whatever you want before letting elm-watch server static files.
- `onUpgrade` is important, but only interesting if your project uses WebSockets too. If you also have your own WebSocket in your project, you can wrap `onUpgrade` to also handle your WebSocket. If you forget `.on("upgrade", onUpgrade)`, then elm-watch’s WebSockets will never connect.
- If you were wondering, you don’t need to add `.on("error", (error) => {...})`. elm-watch does that for you.

For example, you can proxy URLs starting with `/api/` to your backend server:

```js
import * as http from "node:http";
import elmWatch from "elm-watch";

elmWatch(process.argv.slice(2), {
  createServer: ({ onRequest, onUpgrade }) =>
    http
      .createServer((request, response) => {
        if (request.url.startsWith("/api/")) {
          // Proxy /api/* to localhost:9000.
          localhostProxy(request, response, 9000);
        } else {
          // Let elm-watch’s server do its thing for all other URLs.
          onRequest(request, response);
        }
      })
      .on("upgrade", onUpgrade),
})
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("Unexpected elm-watch error:", error);
  });

function localhostProxy(request, response, port) {
  const options = {
    hostname: "127.0.0.1",
    port,
    path: request.url,
    method: request.method,
    headers: request.headers,
  };

  const proxyRequest = http.request(options, (proxyResponse) => {
    response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
    proxyResponse.pipe(response, { end: true });
  });

  proxyRequest.on("error", (error) => {
    response.writeHead(503);
    response.end(
      `Failed to proxy to localhost:${port}. Is nothing running there?\n\n${error.stack}`,
    );
  });

  request.pipe(proxyRequest, { end: true });
}
```

Here’s the same `/api/` example again, but using the [http-proxy] npm package. If you don’t mind the extra dependencies, http-proxy can help if you have a lot of different things to proxy to, including remote servers and WebSockets.

```js
import * as http from "node:http";
import elmWatch from "elm-watch";
import httpProxy from "http-proxy";

const proxy = new httpProxy.createProxyServer({
  target: {
    host: "127.0.0.1",
    port: 9000,
  },
});

elmWatch(process.argv.slice(2), {
  createServer: ({ onRequest, onUpgrade }) =>
    http
      .createServer((request, response) => {
        if (request.url.startsWith("/api/")) {
          // Proxy /api/* to localhost:9000.
          proxy.web(request, response);
        } else {
          // Let elm-watch’s server do its thing for all other URLs.
          onRequest(request, response);
        }
      })
      .on("upgrade", onUpgrade),
})
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("Unexpected elm-watch error:", error);
  });
```

As you can see, this pretty small API surface from elm-watch gives you full control to do what you need in your project (at the expense of being slightly more verbose for the simplest of cases).

On top of that, it also lets you set up HTTPS:

```js
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import * as url from "node:url";
import elmWatch from "elm-watch";

const DIRNAME = path.dirname(url.fileURLToPath(import.meta.url));

// Deal with certificates and HTTPS options in whatever way you’d like:
const CERTIFICATE = {
  key: fs.readFileSync(path.join(DIRNAME, "certificate", "dev.key")),
  cert: fs.readFileSync(path.join(DIRNAME, "certificate", "dev.crt")),
};

elmWatch(process.argv.slice(2), {
  createServer: ({ onRequest, onUpgrade }) =>
    https.createServer(CERTIFICATE, onRequest).on("upgrade", onUpgrade),
})
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error("Unexpected elm-watch error:", error);
  });
```

{: .warning }  
You can’t really log anything in your custom server code – you’ll compete with the output of elm-watch, which clears the screen and moves the cursor to update parts of the output. If your custom server is complicated enough to need logging, make a separate proxy server. Extending elm-watch’s server is better for smaller, “silent” customizations, such as doing a little bit of proxying or setting up HTTPS.

It is _not_ recommended to run other compilers as part of the elm-watch server, such as esbuild or Sass, since they also need to print error messages. Run them as separate watchers. [run-pty] is one way of easily starting multiple watchers with one command.

[http-proxy]: https://github.com/http-party/node-http-proxy
[run-pty]: https://github.com/lydell/run-pty
