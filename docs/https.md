---
title: HTTPS
nav_order: 10
---

# HTTPS

**TL;DR:** I recommend using `http://` for local development. If you really want `https://`, accept elm-watch’s “unsafe” self-signed SSL certificate.

I’d say it’s the most common to use plain old `http://` when working on `localhost`. One could argue that `https://` would be better even for local development since it’s closer to your production environment (which most likely uses `https://`). To be honest, I’ve tried using `https://` for local development and can’t remember a single time it saved me from a bug. Instead it just complicates things with certificates.

With elm-watch HTTPS causes a new complexity: elm-watch uses WebSockets for hot reloading, which results in the question of `ws://` vs `wss://`.

elm-watch uses:

- `ws://` on `http://` pages.
- `wss://` on `https://` pages.

If you use `https://`, then the first time you visit your page you’ll see how elm-watch’s WebSocket gets stuck in the 🔌 connecting state. In the browser console you might see messages about connection errors due to an invalid certificate. You need to accept the certificate to make it work.

Click elm-watch’s [browser UI](../browser-ui/) to expand it. There’s a link there that goes to the WebSocket server. When you click it, your browser will show a scary-looking security screen. That’s because elm-watch uses a self-signed certificate, which isn’t secure. However, there’s no security to worry about here – elm-watch just needs a certificate to be able to use `wss://` (which is basically required on `https://` pages – more on that below). Click a few buttons to proceed to the page anyway. Once you’ve done that once, the browser remembers your choice. Go back to your page (and possibly refresh the page) and now the WebSocket should connect! If you’ve ever created a self-signed certificate yourself for development – that’s exactly what’s happening here. elm-watch ships with a generic self-signed certificate created with `openssl`.

If you’d like to be able to configure the certificate used by elm-watch, let me know!

Here are my findings from testing different combinations of http/s, ws/s, localhost vs not-localhost, and self-signed vs valid certificates:

✅ = Works.  
🤕 = Works with workaround: If elm-watch is using port 12345, you need to visit for example https://localhost:12345 once and accept the self-signed certificate.  
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
