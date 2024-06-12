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
ℹ️ Node.js 16 or newer is required.

```
npx elm-watch --help
```

## Quick start

> 📽 [Video showing how to get started][getting-started-with-elm-watch]

{: .info }  
ℹ️ If you don’t already have an Elm project, create one by running `elm init`.

{: .info }  
ℹ️ Also make sure you have an HTML file. If it works with plain `elm make`, it works with elm-watch. See the next section for inspiration.

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

The command prints the link to a [local development HTTP server](../server) (which is completely optional to use, but easy to get started with).

To build for production:

```
npx elm-watch make --optimize
```

## HTML and other files

elm-watch is only responsible for turning your Elm files into JS files. Like running `elm make src/Main.elm --output build/main.js` yourself. So that’s the mindset you need to have.

**You are responsible for** creating an HTML file, linking to the built JS and initializing the app.

Here’s some HTML to get you started.

- For `Browser.sandbox` and `Browser.element`:

  ```html
  <!-- Absolute URL to the built JS. -->
  <script src="/build/main.js"></script>
  <div id="root"></div>
  <script>
    var app = Elm.Main.init({ node: document.getElementById("root") });
  </script>
  ```

  👉 [Minimal example](https://github.com/lydell/elm-watch/tree/main/example-minimal#readme)

- For `Browser.document` and `Browser.application`:

  ```html
  <!-- Absolute URL to the built JS. -->
  <script src="/build/main.js"></script>
  <script>
    var app = Elm.Main.init();
  </script>
  ```

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
