---
title: HTTPS
nav_order: 11
---

# HTTPS

{: .info }  
**TL;DR:** I recommend using `http://` for local development. If you really want `https://`, there are ways to set that up yourself.

I’d say it’s the most common to use plain old `http://` when working on `localhost`. One could argue that `https://` would be better even for local development since it’s closer to your production environment (which most likely uses `https://`). To be honest, I’ve tried using `https://` for local development and can’t remember a single time it saved me from a bug. Instead it just complicates things with certificates. But there are some niche web features that are only available HTTPS, even on `localhost`.

With elm-watch HTTPS causes a new complexity: elm-watch uses WebSockets for hot reloading, which results in the question of `ws://` vs `wss://`.

elm-watch uses:

- `ws://` on `http://` pages.
- `wss://` on `https://` pages.

elm-watch runs an HTTP server, because WebSockets connect over HTTP before switching to the WebSocket protocol. Now, things differ a little bit depending on the elm-watch version:

- elm-watch 1.0.2 and older only runs an HTTP server.
- elm-watch 1.1.0 added some support for HTTPS: It runs both and HTTP server and an HTTPS server.
- elm-watch beta removes the HTTPS server, but lets you set that up yourself.

## elm-watch 1.1

If you use `https://`, then the first time you visit your page you’ll see how elm-watch’s WebSocket gets stuck in the 🔌 connecting state. In the browser console you might see messages about connection errors due to an invalid certificate. You need to accept the certificate to make it work.

Click elm-watch’s [browser UI](../browser-ui/) to expand it. There’s a link there that goes to the WebSocket server. When you click it, your browser will show a scary-looking security screen. That’s because elm-watch uses a self-signed certificate, which isn’t secure. However, there’s no security to worry about here – elm-watch just needs a certificate to be able to use `wss://` (which is basically required on `https://` pages – more on that below). Click a few buttons to proceed to the page anyway. Once you’ve done that once, the browser remembers your choice. Go back to your page (and possibly refresh the page) and now the WebSocket should connect! If you’ve ever created a self-signed certificate yourself for development – that’s exactly what’s happening here. elm-watch ships with a generic self-signed certificate created with `openssl`.

Using a self-signed certificate isn’t ideal, and cannot be used by everyone. Also, running both HTTP and HTTPS in elm-watch is pretty complicated. This is why `elm-watch@beta` switched to a new approach, where you are in full control over HTTPS.

## elm-watch beta

`elm-watch@beta` puts its HTTP server to more use than just connecting WebSockets: It also optionally [serves static files](../server/). That static file server is HTTP, not HTTPS, but the code for choosing between `ws://` and `wss://` based on if you’re on an `https://` page is still there. How can it be `https://` then? That’s if you serve the files yourself on your own HTTPS server (or if you run elm-watch in a certain way – which I’ll get back to).

Like in elm-watch 1.1, if you use `https://` then you might see how elm-watch’s WebSocket gets stuck in the 🔌 connecting state. That’s because it tries to connect with `wss://` over HTTPS, but elm-watch only runs an HTTP server. In the [browser UI](../browser-ui/), instead of showing a link to a page where you can accept a self-signed certificate, `elm-watch@beta` now just links to this page instead, where you can read up on how to get HTTPS going.

If you use your own HTTPS server, you can set the `"webSocketUrl"` option in [elm-watch.json](../elm-watch.json/) or the `ELM_WATCH_WEBSOCKET_URL` environment variable to make elm-watch connect to your HTTPS server instead of directly to elm-watch’s HTTP server. In your HTTPS server you need to proxy the WebSocket to elm-watch. Alternatively, you can set up a separate HTTPS proxy server just for elm-watch’s WebSocket if you prefer.

You can also run elm-watch in an alternate way with a [custom server](../server/#custom-server) to set up HTTPS:

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

## Research

Here are my findings from testing different combinations of http/s, ws/s, localhost vs not-localhost, and self-signed vs valid certificates:

✅ = Works.  
🤕 = Works with workaround: If the WebSocket connects to port 12345, you need to visit for example https://localhost:12345 once and accept the self-signed certificate.  
💥 = `new WebSocket("ws://...")` immediately throws an error (that can be caught using `try-catch`).  
❌ = `new WebSocket("ws://...")` throws no error, but the WebSocket never connects.  
📢 = A warning is logged to the browser console. It cannot be turned off.  
❓ = Not tested.

| Origin | Certificate | WebSocket | Chrome | Firefox | Safari | iOS Safari |
| --- | --- | --- | --- | --- | --- | --- |
| http: | n/a | ws: | ✅ | ✅ | ✅ | ✅ |
| https://localhost | self-signed | ws: | ✅ | ✅ | ❌📢 | ❌📢 |
| https://localhost | self-signed | wss: | ✅ | 🤕 | 🤕 | ✅ |
| https://example.com | self-signed | ws: | 💥📢 | 💥 | ❌📢 | ❓ |
| https://example.com | self-signed | wss: | ✅ | 🤕 | 🤕 | ❓ |
| https://example.com | valid | ws: | 💥📢 | 💥 | ❌📢 | ❌📢 |
| https://example.com | valid | wss: | ✅ | ✅ | ✅ | ✅ |

Summary:

- ✅ `http:` with `ws:` works perfectly.
- ✅ Valid `https:` with `wss:` works perfectly.
- 🤕 Self-signed `https:` with `wss:` works pretty good.
- 🚨 `https:` with `ws:` depends:
  - It might work sometimes (localhost).
  - It might throw an error.
  - It might never connect.
  - It might pollute the browser console.
