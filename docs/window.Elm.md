---
title: window.Elm
nav_order: 11
---

# window.Elm

elm-watch is basically just `elm-watch make`, so the output format is using the good old `window.Elm` global.

elm-watch even _requires `window.Elm` to exist._ That global variable is key to make [hot reloading](../hot-reloading/) work. (Technically, `globalThis.Elm` is required to exist. See below.)

**In short:** Keep it simple and load the built Elm JS in its own `<script>` tag and you’ll be fine.

If you’re coming from [webpack], [Parcel] or [Vite], you need to update your JavaScript entrypoint like so:

```diff
-import { Elm } from "./src/Main.elm";

const root = document.getElementById("root");
-const app = Elm.Main.init({ node: root });
+const app = window.Elm.Main.init({ node: root });
```

Regardless of whether you use a bundler or just standard `import`s, **don’t** be tempted to `import` the built Elm JS:

```js
// 🚨 WRONG! Don’t do this!
import Elm from "./build/main.js";

// 🚨 WRONG! Don’t do this either!
import "./build/main.js";
```

Instead, load the built Elm JS in a separate script tag, _without_ any `type` attribute:

```html
<!-- 🚨 WRONG! Don’t do this! -->
<script type="module" src="./build/main.js"></script>

<!-- ✅ Correct! No `type` is the way to go. -->
<script src="./build/main.js"></script>
```

Why? Because of _scripts_ vs _modules._ Back in the day, only JavaScript _scripts_ existed, but since the `import` syntax came along we also have _modules._ They are essentially two different _modes_ for JavaScript with slightly different behavior.

- Module mode is enabled via the `type="module"` attribute on the `<script>` tag, or by using `import` to load a file.
- Script mode is used for everything else.

The built Elm JS is simply not made for module mode:

- It does not use the `export` keyword, so there’s nothing to `import` from it.
- It uses an old-school technique to create the `window.Elm` global: It basically does `this.Elm = stuff`. In script mode, `this` refers to the global object, which usually is `window`. The reason for using `this` is to make [Platform.worker] programs usable in [Web Workers] and Node.js (where `window` does not exist). But in module mode, global `this` is always `undefined`.

If you use a bundler, `import`ing the built Elm JS can have additional downsides:

- The bundler might rewrite that global `this` mentioned above to `exports` (a local object) in an attempt to support `import`ing old-school packages. However, then `window.Elm` won’t be created.
- The bundler might waste time parsing the whole built Elm JS file for nothing.

elm-watch _could_ replace the `this` in the built Elm JS with [globalThis] which the modern way of getting the global object no matter what environment. But elm-watch takes a very conservative approach: For `elm-watch make`, the built Elm JS is just the output of `elm make` with no modifications at all. Patching that output is not the job of elm-watch, and would lead to the question of where to stop. _You_ can choose to make that modification in a [postprocess](../postprocess/) script, though, if you really feel like it.

Having `window.Elm.Main.init()` in your code might feel ugly and old-school compared to using `import`, but I think it’s fine:

- It’s simple.
- It’s just going to affect one line of your code.
- It lets you decouple your Elm completely from all other JavaScript.
- It makes hot reloading work without any setup.
- And it can even be good for browser caching! Your Elm code might change very often, but some JavaScript code (perhaps using an npm package) might be very stable and can then be cached independently from the compiled Elm code.

[globalthis]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis
[parcel]: https://parceljs.org/
[platform.worker]: https://package.elm-lang.org/packages/elm/core/latest/Platform#worker
[vite]: https://vitejs.dev/
[web workers]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
[webpack]: https://webpack.js.org/
