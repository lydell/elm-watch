---
title: Getting started
nav_order: 2
---

<!-- prettier-ignore-start -->

# Getting started
{: .no_toc }

1. TOC
{:toc}

<!-- prettier-ignore-end -->

## Installation

```
npm install --save-dev elm-watch
```

{: .info }  
ℹ️ You need to install Elm itself separately, in whatever way you prefer ([installer][elm-guide-install], [npm][elm-npm-package], [unofficial npm][unofficial-npm], [elm-tooling]).

{: .info }  
ℹ️ Node.js 14 or newer is required. On Windows, only Node.js 16 or later is officially supported.

```
npx elm-watch --help
```

## Quick start

> 📽 [Video showing how to get started][getting-started-with-elm-watch]

{: .info }  
ℹ️ If you don’t already have an Elm project, create one by running `elm init`.

Create a file called [elm-watch.json](../elm-watch.json/):

```
npx elm-watch init
```

<!-- prettier-ignore -->
```json
{
    "targets": {
        "My target name": {
            "inputs": [
                "src/Main.elm"
            ],
            "output": "build/main.js"
        }
    }
}
```

Start watching with hot reloading:

```
npx elm-watch hot
```

To build for production:

```
npx elm-watch make --optimize
```

{: .info }  
ℹ️ elm-watch is _not_ a file server. See the next section.

## Your responsibilities

elm-watch is only responsible for turning your Elm files into JS files. Like running `elm make src/Main.elm --output build/main.js` yourself. So that’s the mindset you need to have.

**You are responsible for** creating an HTML file, linking to the built JS, serving files and initializing the app.

- If you’re just getting started, you can create an HTML file with a relative link to the built JS and double-click it to open it in a browser.

  ```html
  <!-- Relative URL to the built JS. -->
  <script src="./build/main.js"></script>
  <div id="root"></div>
  <script>
    var app = Elm.Main.init({ node: document.getElementById("root") });
  </script>
  ```

  👉 [Minimal example](https://github.com/lydell/elm-watch/tree/main/example-minimal#readme)

- …except if you use `Browser.application`. It doesn’t work on the `file://` protocol. There are plenty of quick little “please serve this directory on localhost” tools, though.

  ```html
  <!-- Absolute URL to the built JS. -->
  <script src="/build/main.js"></script>
  <script>
    var app = Elm.Main.init();
  </script>
  ```

  👉 [Example CLI server tool](https://github.com/vercel/serve)

- If you need TypeScript and CSS compilation, you need to set up another build tool alongside elm-watch.

  ```html
  <!-- Separate script tag for Elm. -->
  <script src="/build/main.js"></script>
  <!-- Another script tag for JS built by another tool. -->
  <script src="/build/bundle.js"></script>
  ```

  👉 [Example with esbuild](https://github.com/lydell/elm-watch/tree/main/example#readme)

{: .info }  
ℹ️ elm-watch **requires** [window.Elm](../window.Elm/) to exist!

[elm-guide-install]: https://guide.elm-lang.org/install/elm.html
[elm-npm-package]: https://github.com/elm/compiler/tree/master/installers/npm
[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli/
[getting-started-with-elm-watch]: https://www.youtube.com/watch?v=n15nOCZnTac
[unofficial-npm]: https://github.com/lydell/compiler/tree/zero-deps-arm-lydell/installers/npm
