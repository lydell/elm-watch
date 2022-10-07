# elm-watch

> `elm make` in watch mode. Fast and reliable.

elm-watch recompiles whenever your Elm files change and reloads the compiled JS in the browser.

- 👉 [Getting started](https://github.com/lydell/elm-watch#getting-started)
- 👉 [What elm-watch is](https://github.com/lydell/elm-watch#what-elm-watch-is)

Note that elm-watch is all about Elm. Not HTML, not CSS, not JavaScript, not TypeScript and not serving files or proxying requests. That’s a strength in my opinion, but also something to be aware of. You can’t just replace for example Parcel with elm-watch and expect everything to be taken care of.

## Installation

```
npm install --save-dev elm-watch
```

> ℹ️ You need to install Elm itself separately, in whatever way you prefer ([installer][elm-guide-install], [npm][elm-npm-package], [elm-tooling]).

> ℹ️ Node.js 14 or newer is required. On Windows, only Node.js 16 or later is officially supported.

## Getting started

> 📽 [Video showing how to get started][getting-started-with-elm-watch]

Create a file called [elm-watch.json](#elm-watchjson):

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

That’s pretty much it! For the remaining details:

```
npx elm-watch --help
```

elm-watch is only responsible for turning your Elm files into JS files. Like running `elm make src/Main.elm --output build/main.js` yourself. So that’s the mindset you need to have.

**You are responsible for** creating an HTML file, link to the built JS and serve files.

- If you’re just getting started, you can create an HTML file with a relative link to the built JS and double-click it to open it in a browser.

  ```html
  <!-- Relative URL to the built JS. -->
  <script src="./build/main.js"></script>
  ```

  👉 [Minimal example](./example-minimal)

- …except if you use `Browser.application`. It doesn’t work on the `file://` protocol. There are plenty of quick little “please serve this directory on localhost” tools, though.

  ```html
  <!-- Absolute URL to the built JS. -->
  <script src="/build/main.js"></script>
  ```

  👉 [Example CLI server tool](https://github.com/vercel/serve)

- If you need TypeScript and CSS compilation, you need to set up another build tool alongside elm-watch.

  ```html
  <!-- Separate script tag for Elm. -->
  <script src="/build/main.js"></script>
  <!-- Another script tag for JS built by another tool. -->
  <script src="/build/bundle.js"></script>
  ```

  👉 [Example with esbuild](./example)

ℹ️ Note: elm-watch **requires** [window.Elm](#windowelm) to exist!

## What elm-watch _is_

Remember the first time you ran `elm make`? It’s super fast, and has beautiful output. And it’s really stable! If the majority of your code is Elm, why complicate things with extra layers where things can go wrong? elm-watch tries to stay as close as that ideal as possible.

- **Maximum speed.** elm-watch tries to do as little as possible besides running `elm make` for you. Doing less work is always faster!
- [**Hot reloading.**](#hot-reloading) elm-watch tries to reimagine the level of quality of hot reloading. The goal is to never leave you wondering if it worked at all.
- **Beautiful colors.** Elm’s error messages are lovely and colorful. elm-watch takes care to preserve them.
- [**Browser UI.**](#browser-ui) elm-watch always shows you the latest status in the browser. Switching to `--debug` mode – or even `--optimize` mode – is only a click away.
- **Cache free.** Elm already has a cache – the `elm-stuff/` folder – which is really stable and all you need. Famously one of the hardest things in programming, elm-watch has no extra caching to worry about.
- **Elm centric.** elm-watch puts Elm at the heart. Let’s take advantage of Elm’s unique capabilities, like `elm make --output /dev/null` for super fast type checking of apps you’re not currently focusing on!
- [**Reasonably hackable.**](#postprocess) Ever wanted to adjust Elm’s compiled JS? That’s just a `String -> String` function away for both development and production builds.
- **Well tested.** elm-watch has 100 % test coverage, save for a few ignore coverage comments. elm-watch is serious about stability.
- **Super scalable.** elm-watch can handle many Elm apps without getting slow. Only the apps you work on get compiled – in most recently used order. The rest are only type checked, which is faster.

👉 See also [Comparison to other tools](#comparison-to-other-tools).

## What elm-watch is _not_

- A watcher for other things than Elm files.
- A watcher for Elm _packages._
- A file server.
- A proxy server.
- A code generator.
- A test runner.

It is tempting to put in simple versions of the above so that you can just run `elm-watch` and get going just like with [Parcel]. While that’s convenient for small toy projects, you’ll eventually grow out of it. That’ll result in endless feature requests – taking time from the core mission of elm-watch – or you having to set up your own stuff for non-Elm things anyway.

So I like to think of elm-watch more of a “professional” tool. Let elm-watch excel at compiling Elm quickly and reliably, and own the rest of the stack yourself. Have your own development server, your own TypeScript compiler and your own CSS setup or whatever you need.

That being said, it’s not super difficult to set elm-watch up together with other tools. See the [example/](./example) folder for a lean and sweet setup with [esbuild], and [run-pty] for easily starting `elm-watch`, `esbuild` and a dev server in one go.

But if you’re looking for a out-of-the-box setup, try [Parcel], [elm-go] or some other tool with the same goals. Choose your trade-offs.

At least for now, elm-watch is focused on Elm **Applications only.** I can think of two other use cases:

- Type checking packages.
- Type checking tests.

In both cases, `elm-test --watch` might be a better alternative. You get to see if your tests pass, too!

For a package, it doesn’t take many tests to reach the point where if the tests compile, the package compiles too. Other than that, relying on type checking in your editor and occasionally running `elm make` (without arguments) in the terminal might be enough. Check out [issue #23](https://github.com/lydell/elm-watch/issues/23) if you’d like to see package support.

## window.Elm

elm-watch is basically just `elm-watch make`, so the output format is using the good old `window.Elm` global.

elm-watch even _requires `window.Elm` to exist._ That global variable is key to make [hot reloading](#hot-reloading) work. (Technically, `globalThis.Elm` is required to exist. See below.)

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

elm-watch _could_ replace the `this` in the built Elm JS with [globalThis] which the modern way of getting the global object no matter what environment. But elm-watch takes a very conservative approach: For `elm-watch make`, the built Elm JS is just the output of `elm make` with no modifications at all. Patching that output is not the job of elm-watch, and would lead to the question of where to stop. _You_ can choose to make that modification in a [postprocess](#postprocess) script, though, if you really feel like it.

Having `window.Elm.Main.init()` in your code might feel ugly and old-school compared to using `import`, but I think it’s fine:

- It’s simple.
- It’s just going to affect one line of your code.
- It lets you decouple your Elm completely from all other JavaScript.
- It makes hot reloading work without any setup.
- And it can even be good for browser caching! Your Elm code might change very often, but some JavaScript code (perhaps using an npm package) might be very stable and can then be cached independently from the compiled Elm code.

## Ideas for the future

- **Interactive errors.** Filter by target or Elm file. Collapse long code snippets (`case` expressions).
- **Debug redux.** Apart from the standard `--debug` mode, also offer the [Redux DevTools] just one click away. Like [elm-monitor] and [elm-remotedev] but with no extra setup.
- **Stand-alone binary.** While I’ve kept the npm dependencies for elm-watch to a bare minimum, it would be nice with a lean, super resource efficient, stand-alone binary. Most of elm-watch’s tests are written at a very high level, so they should be reusable with an implementation written in any language with too much work. I’ve been thinking about writing it in Rust, or forking the Elm compiler and building the watcher straight into it (while making no other changes) – which would unlock even more potential, since I can access internals.

## Terminal UI

elm-watch displays the status of each target in [elm-watch.json](#elm-watchjson), as well as some timings, stats, recent events (like files that have changed) and – of course – Elm compilation errors. It should be pretty self explanatory. Use `elm-watch --help` if you wonder what some status emoji or symbol means.

## Browser UI

When using `elm-watch hot`, you’ll see a little box in the bottom-left corner of the browser window, looking something like this:

```
▼ ✅ 13:10:05
```

It shows the current status. The ✅ means all is good and there are no compilation errors. 13:10:05 is the last time the status was updated. That’s especially useful for knowing when the last hot reload was applied. No more wondering “did the hot reload stop working? Or did I edit the wrong piece of code?” If the time has updated, so has the running code. On top of that, there’s an animation – a green circle growing from the ✅ and fading out as it goes – to let you know that a hot reload has gone through successfully.

Clicking the box expands it, letting you switch between the “standard” compilation mode, `--debug` and `--optimize`. elm-watch remembers your choice (per target) across restarts. So if you prefer to have the Elm debugger on at all times, it’s easy to do!

If the UI is in the way, you can move it to another corner using the arrow buttons. elm-watch remembers that choice per target across restarts as well.

Here are some more icons you might see (they’re also explained when you expand the box):

- 🔌: Connecting
- ⏳: Waiting for compilation
- 🚨: Compilation error
- ⛔️: Eval error
- ❌: Unexpected error

Pay extra attention to 🚨 (compilation error). If you see it, the latest changes to your Elm files didn’t compile, **so you’re running an older version of your app.** Many build tools put an overlay across the entire browser window in this case, showing the compilation error. I find that very annoying:

- I prefer seeing the errors in the terminal, in the place they were designed to be displayed.
- I often want to play around with my app while making changes. I might refactor something and wonder exactly how the app used to behave in a certain situation. Some error overlays prevent you from doing that, or require you to repeatedly close it. It’s nice having a runnable version of your app locally as much of the time as possible, even if the code is currently messy, in my opinion.

To make that 🚨 more noticeable, there’s a similar animation as for ✅ – a growing and fading _red_ circle – which also is repeated every time you focus the tab (switch to it from another tab or window, or move focus from the dev tools to the page).

## elm-watch.json

An `elm-watch.json` file is required to be able to use `elm-watch`. There’s not that much to know about it.

You can place it anywhere, basically. elm-watch uses the closest `elm-watch.json` file it finds up the directory tree. You can have a single `elm-watch.json` for several apps with different `elm.json` if you want.

The contents of `elm-watch.json` looks like this (TypeScript definition):

```ts
type NonEmptyArray<T> = [T, ...Array<T>];

type ElmWatchJson = {
  postprocess?: NonEmptyArray<string>;
  port?: number;
  targets: {
    [name: string]: {
      inputs: NonEmptyArray<string>;
      output: string;
    };
  };
};
```

Example:

<!-- prettier-ignore -->
```json
{
    "postprocess": ["elm-watch-node", "postprocess.js"],
    "port": 9876,
    "targets": {
        "My target name": {
            "inputs": [
                "src/Main.elm"
            ],
            "output": "build/main.js"
        },
        "😎 My other target": {
            "inputs": [
                "src/One.elm",
                "src/Two.elm"
            ],
            "output": "build/other/dist.js"
        }
    }
}
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| [targets](#targets) | `Record<string, object>` | _Required_ | The input Elm files to compile and the output JavaScript files to write to. At least one target is required. |
| [postprocess](#postprocess) | `NonEmptyArray<string>` | No postprocessing. | A command to run after each `elm make` to transform Elm’s JavaScript output. |
| port | `number` | An arbitrary available port. Tries to re-use the same port as last time you ran elm-watch. | Web Socket port for hot reloading. In case you _have_ to have the exact same port every time. Note that [some ports cannot be used][port-blocking]. |

### targets

There isn’t much to say about `"targets"` really. You define what elm-watch should compile.

It’s an object. They keys can be whatever you want, basically. They’re displayed in the terminal UI. They’re passed to your [postprocess](#postprocess) script. You can also filter by target substring: `elm-watch make app 🇸🇪` would build only targets containing “app” or “🇸🇪”.

For each target, provide the following:

- inputs: `NonEmptyArray<string>`. List of `.elm` files, relative to `elm-watch.json`. You probably only need one input, but if you’ve ever used `elm make` with multiple inputs – you can do that with elm-watch as well.
- output: `string`. A `.js` file, relative to `elm-watch.json`. Unlike `elm make`, only `.js` is supported (and `.html` isn’t). Once you reach for elm-watch, you’re ready to be in charge of your own HTML file.

### postprocess

> ℹ️ Postprocessing is an “advanced” feature. If you’re just starting out – skip it.

This lets you change Elm’s JavaScript output. There are two use cases for this:

- Patch the JS during development as well as in production.
- Minify the JS in production.

The `"postprocess"` field is a non-empty array, describing a command to run. There are two types of commands:

- [External process](#external-process) – run any program written in any language
- [elm-watch-node](#elm-watch-node) – run a Node.js inside the elm-watch process itself for performance

If you’re in a hurry, I recommend going straight to [elm-watch-node](#elm-watch-node), but reading [External process](#external-process) gives the full story.

The goal of the postprocessing feature is to be an easier way of transforming Elm’s JavaScript output than learning how to write for example a [webpack plugin]. It’s essentially just a `String -> String` function, while still giving you full control. To push you in the “full control” direction, there are no “shortcuts” for postprocessing in elm-watch – the only way to do it is to write a small script (see the following two sections).

#### External process

The first item of the `"postprocess"` array is the name of the command to spawn: It’s looked up in `PATH`, falling back to being relative to `elm-watch.json`. The remaining items are simply arguments to pass to the spawned command. Note: The arguments are just strings, not `bash` code or something like that. The command is run with CWD set to the `elm-watch.json` directory.

Apart from the specified arguments, elm-watch appends some more, in this order:

1. Target name. One of the keys of the `"targets"` object in `elm-watch.json`. This let’s you apply more time consuming minification for a customer facing app than for an internal one, for example.
2. Compilation mode. Either `"debug"`, `"standard"` or `"optimize"`. This lets you only minify in `--optimize` mode, for example.
3. Run mode. Either `"make"` or `"hot"`. I recommend doing the same work for both modes, but in case that’s not feasible you have the possibility.

For example, if you have `"postprocess": ["bash", "postprocess.bash", "one", "two"]` your script might receive these 5 arguments: `one two "My target name" standard hot`.

The command is expected to:

1. Read stdin. You get Elm’s JS as input.
2. Write to stdout. Write transformed JS as output.
3. Exit with code 0. Otherwise an error will be reported, with stdout and stderr printed.
4. Not do any side effects. Think of your command as a `String -> String` pure function.

Example (in `bash`):

```bash
target_name="$1"
compilation_mode="$2"
run_mode="$3"

patch() {
  # Silly example of patching the output, which just changes all occurrences of
  # the string 'apple' to 'banana'.
  sed "s/'apple'/'banana'/g"
}

case "$compilation_mode" in
  debug|standard)
    patch
    ;;

  optimize)
    # Also minify with esbuild in --optimize mode.
    patch | ./node_modules/.bin/esbuild --minify
    ;;

  *)
    echo "Unknown compilation mode: $compilation_mode"
    exit 1
    ;;
esac
```

Debugging tip: Print stuff to stdout **and exit with code 1.** For example, `echo "my debug stuff"; exit 1`. Then elm-watch will report the error, and print all stdout and stderr it got so far. (If you exit with code 0, your debug prints will end up in the compiled JS.)

#### elm-watch-node

Node.js might feel nice to write postprocess scripts in:

- You already have it installed since elm-watch is built on it.
- It may be easier to write than for example `bash`.
- It’s cross platform.
- You might want to call an `npm` package in your postprocessing.

However, **it’s slow to boot.** Around 100 ms of penalty even for the simplest of scripts. It might not sound like much, but it’s not nice for hot reloading. Compare that to `bash` which runs in more like 1 ms.

To avoid the slowness, elm-watch has a trick up its sleeve: `elm-watch-node`. In your `elm-watch.json`, make this change:

```diff
-"postprocess": ["node", "postprocess.js"]
+"postprocess": ["elm-watch-node", "postprocess.js"]
```

It’s basically the same but faster. The difference is that `elm-watch-node` runs in a [worker thread] instead of as a separate process (it’s not a real command you can run on your own). Workers are faster to spawn (around 50 ms) – and it’s a one time cost. Once started, they can be reused infinitely, resulting in almost no overhead at all.

Here are the differences compared to `node`.

- The `"postprocess"` array must be exactly 2 items: `"elm-watch-node"` plus the file to run. No other flags or arguments to `node` are supported.
- Your code runs in the same process (but on a thread) as elm-watch, so you don’t get an isolated environment.
- Instead of using stdin, stdout, process arguments and exit codes you just provide a good old pure function (see below).

`elm-watch-node` scripts must export a function:

```js
// CJS
module.exports = function postprocess() {};

// MJS
export default function postprocess() {}
```

Type definition (importable from `"elm-watch/elm-watch-node"` if you want):

```ts
type Postprocess = (options: {
  code: string;
  targetName: string;
  compilationMode: "debug" | "standard" | "optimize";
  runMode: "hot" | "make";
  argv: Array<string>; // Mimics process.argv
}) => string | Promise<string>;
```

- Instead of looking at `process.argv`, look at the single `options` object passed to your function.
- Instead of reading `process.stdin`, look at `options.code` (it’s a string).
- Instead of writing to `process.stdout`, return a string. (Or a `Promise<string>`.)
- Instead of using `process.exitCode = code` or `process.exit(code)`, return normally on success and throw an error on failure.
- Note: It’s up to you to configure Node.js to accept CJS or MJS like any Node.js project. elm-watch simply `import()`s your script, so that’s the interface you have to work with. If you’re unsure, go with `module.exports`. If you’re hipster, choose `export default`.

Example:

```js
// @ts-check
import minify from "some-minifier";

function patch(code) {
  // Silly example of patching the output, which just changes all occurrences of
  // the string 'apple' to 'banana'.
  return code.replace(/'apple'/g, "'banana'");
}

/**
 * @type {import("elm-watch/elm-watch-node").Postprocess}
 */
export default function postprocess({ code, compilationMode }) {
  switch (compilationMode) {
    case "standard":
    case "debug":
      return patch(code);

    case "optimize":
      return minify(patch(code));

    default:
      throw new Error(
        `Unknown compilation mode: ${JSON.stringify(compilationMode)}`
      );
  }
}
```

Debugging tip: Use `console.log("my debug stuff", 1 + 1); throw new Error()`. Then elm-watch will report that error, and print stuff that you’ve logged. (If you use _only_ `console.log("my debug stuff")` with no `throw new Error()` you won’t see the log).

> Note: `elm-watch-node` is only available because elm-watch happens to be written in Node.js. An [implementation written in another language](#ideas-for-the-future) is not expected to embed a JavaScript runtime just to implement `elm-watch-node`. In such a case you will have to make do with some other faster scripting language (like `bash`), or pay the penalty of starting `node` every time.

#### Postprocess notes

You might wonder why minifying for production is a concern for elm-watch, which tries to focus _only_ on Elm. Couldn’t you just minify yourself after running `elm-watch make`?

- Well, you _could,_ but minifiers can be slow so running in parallel is important. But annoying to code! So you’re probably not going to do it.
- elm-watch needs parallel postprocessing anyway for patching during development.
- I think it’s nice to be able to easily test your minified code. With elm-watch, it’s one click away.

Apart from minifying, you might be tempted to also cache-bust the JS files by putting a hash of their content in the file name. For example: `main.js` ➡️ `main.50f612.js`. It’s not a good idea to do that _in the postprocess script,_ though. While you might get away with creating the files as a side effect in your postprocess script, you also want to keep track of them all in one place and update HTML files pointing to them. Since all postprocess commands run in parallel, that can be tricky to do correctly (you’ll probably end up with parallel invocations overwriting each other). I suggest doing that as a separate step afterwards. (Unlike minifying, hashing and updating HTML files should be fast, so no need to worry about parallelization.) elm-watch assumes that your command is pure, so if you do things that makes that assumption not hold you’re on your own.

## Hot reloading

> **Note:** The goal is to have 100 % reliable hot reloading. However, it’s not possible without changes to the compiler. elm-watch gets maybe 90 % of the way there.
>
> elm-watch tries really hard to detect if a hot reload is possible. Changes to `view` are always safe, but changes to `Model` and `Msg` can sometimes lead to your program crashing at some point.
>
> Feel free to report bugs about weirdness after hot reloading! Some things won’t be solvable, but some might be!
>
> Read on for more details.

Some exciting elm-watch hot reloading features:

- **Scroll position.** Hot reloading is just like another regular Elm rerender in elm-watch. Scroll position (and other subtle DOM state) is kept.
- **Full reloads.** When not possible to hot reload, elm-watch reloads the full page for you. It also tells you why in the browser console.
- **Complete coverage.** elm-watch supports hot reloading all `Program` types and does as good as it can with all types of changes: `init` (and flags), `update`, `view`, `subscriptions`, `ports`.
- **Clever prioritization.** Working on three Elm apps simultaneously? elm-watch compiles the one you interacted with most recently first. Apps that you don’t work on aren’t compiled at all – just type checked, which is much faster!

That said, hot reloading is essentially a hack. But a pretty good one. As long as hot reloading isn’t built into Elm itself, it’s always going to be a hack and not 100 % perfect:

- Changes to `Model`. Hot reloading is all about running new code with the previous state. That only works if the previous state is compatible – otherwise your `update` and `view` might throw errors. Elm actually has a way to tell if `Msg` has changed, as part of the Import/Export feature in the debugger. If hot reloading were built into Elm, the same could be used to diff the `Model`. elm-watch instead tries to detect that by running the updated `init` function. If it returns something different than last time it can mean:

  - That you tweaked a value. Like changing `velocity = 5` to `velocity = 10`. elm-watch detects that, and reloads the page so you can try out the new initial state.
  - That you changed the `Cmd`s returned. elm-watch detects that too, and again reloads the page so you can try them out.
  - That you added, removed or renamed a field in a record. That’s a very common change, and easy to detect! elm-watch reloads the page since model and functions aren’t compatible.
  - That you changed a type from for example `Int` to `String`. elm-watch can detect it.
  - That you changed things with a custom type. This is where it gets tricky. Let’s say you changed from `Maybe Int` to `Maybe String`, but in `init` you always start with `Nothing`. elm-watch will have no clue about the change! However, if your `view` function immediately throws an error due to trying to use a number as a string, elm-watch catches that and reloads the page for you so you don’t waste time in a broken environment. This is where a full `Model` type-wise diff would be needed.

- Code complexity. If hot reloading was built into Elm, the generated JavaScript could be altered to be easier to hot reload. elm-watch has to bend over backwards a bit to adjust the generated JavaScript after it has been generated. It’s a bit of regex replacements, as well as replacements for whole functions. Regex might sound brittle, but luckily Elm’s generated JavaScript is very predictable. While it’s impossible to do safe replacements on input that can be _any_ JavaScript (written by a human), it’s actually 100 % safe on Elm’s machine written JavaScript. There are no tricky comments that can fool the regexes, and no multiline strings. (`"""` strings are compiled to single lines with `\n`s in them.) And all your functions and variables are prefixed, so they can’t be confused with core functions. By anchoring all regexes to beginnings of lines – and having heaps of tests – elm-watch can ensure it never messes with _your_ code. That’s great because regex is _fast._ Hot reloading isn’t hot if it’s slow.

- You need a recent enough elm/core version. Otherwise some regexes don’t match. Perfect time to update, though!

In case you’re wondering, elm-watch has its own hot reloading implementation, built with Elm’s needs at the core. In other words, elm-watch is _not_ using the common [elm-hot] package (which is more focused on fitting into the hot reloading systems of [webpack] and [Parcel]).

elm-watch’s hot reloading works by injecting an extra little program into your built JavaScript files (when running `elm-watch hot` only, not `elm-watch make`). It renders the browser UI in the bottom-left corner, and connects to elm-watch’s Web Socket server. You’re not supposed to really notice or have to think any of that, but it can help to know how the “magic” works when debugging things. Or just for fun.

## HTTPS

**TL;DR:** Use `http://` for local development.

I’d say it’s the most common to use plain old `http://` when working on `localhost`. One could argue that `https://` would be better even for local development since it’s closer to your production environment (which most likely uses `https://`). To be honest, I’ve tried using `https://` for local development and can’t remember a single time it saved me from a bug. Instead it just complicates things with certificates.

With elm-watch HTTPS causes a new complexity. elm-watch uses Web Sockets for hot reloading. So now there’s the question of `ws://` vs `wss://`. Here are my findings last time I dove into this:

✅ = works  
🤕 = works with workaround  
💥 = throws an error  
❌ = never connects  
📢 = logs a warning

| Origin | Certificate | Web Socket | Chrome | Firefox | Safari | iOS Safari |
| --- | --- | --- | --- | --- | --- | --- |
| http: | n/a | ws: | ✅ | ✅ | ✅ | ✅ |
| https://localhost | self-signed | ws: | ✅ | ✅ | ❌📢 | ❌📢 |
| https://localhost | self-signed | wss: | ✅ | 🤕 | 🤕 | ✅ |
| https://example.com | self-signed | ws: | 💥📢 | 💥 | ❌📢 | ? |
| https://example.com | self-signed | wss: | ✅ | 🤕 | 🤕 | ? |
| https://example.com | true signed | ws: | 💥📢 | 💥 | ❌📢 | ❌📢 |
| https://example.com | true signed | wss: | ✅ | ✅ | ✅ | ✅ |

- ✅ The Web Socket just connects without any problems.
- 🤕 Required workaround: If elm-watch is using port 12345, you need to visit for example https://localhost:12345 once and accept the self-signed certificate. Then you can refresh https://localhost and the Web Socket should connect.
- 💥 `new WebSocket("ws://...")` immediately throws an error (that can be caught using `try-catch`).
- ❌ `new WebSocket("ws://...")` throws no error, but the Web Socket never connects.
- 📢 A warning is logged to the browser console no matter what.

Summary:

- ✅ `http:` with `ws:` works perfectly.
- ✅ True signed `https:` with `wss:` works perfectly.
- 🤕 Self-signed `https:` with `wss:` works pretty good.
- 🚨 `https:` with `ws:` depends:
  - It might work sometimes in some browsers.
  - It throw an error.
  - It might never connect.
  - It might pollute the browser console.

Because of the above, elm-watch:

- Always uses `ws:` on `http:` pages.
- Always uses `wss:` on `https:` pages.

TODO:

- `ws://` works fine on `https://localhost` in both Chrome and Firefox these days.
- However, Safari Desktop requires `wss://` on `https://` pages (even localhost).
- You can use a self-signed certificate (but get security prompts in the browser). If you set up your `https://` and `wss://` with the same certificate, it works seamlessly.
- …except that Firefox requires you to separately visit the `wss://` origin and accept the unsafe certificate, which is very non-intuitive.
- Safari for iOS does not seem to allow self-signed certificates for Web Sockets at all.

In short, you _can_ use a simple `ws://` together with `https://` in _some_ cases. But to get things working all the time, you would have to create a certificate and add it to your computer OS and phone OS so it becomes trusted for real. Which is a bit annoying. If you are doing that and would like to be able to configure elm-watch to use that certificate as well (with `wss://`), please let me know! Until then, elm-watch keeps things simple and _always_ uses `ws://`.

## Comparison to other tools

### elm-watch vs generic watcher tools

There are many CLI programs that let you watch for file changes and then run a given command. So you could listen for changes to `.elm` files (as well as `elm.json`) and have `elm make src/Main.elm --output build/main.js` as the command to run. Can’t get much simpler, right? What does elm-watch bring to the table then? Here are some interesting points to better understand what value elm-watch can bring:

- **Timing control.** What happens when files change faster than `elm make` runs? Like, if you happen to save a lot in the editor, refactor across files or switch git branches? Maybe the `elm make` calls queue up – and take a lot of extra time to complete – or maybe some events are dropped and you end up with out-of-date compilation error messages. elm-watch waits a couple of milliseconds after each file change event to let things settle before compiling. And if even more files change while compiling, _one_ new compilation is triggered.

- **Multiple targets.** Your project grows bigger, and suddenly you don’t have just `src/Main.elm` but also `src/Admin.elm` and maybe some other apps. Do you just update the command to `elm make src/Main.elm --output build/main.js; elm make src/Admin.elm --output build/main.js`? Now you have many problems:

  - **Wasteful compilation.** If you change `src/AdminHelpers.elm`, `src/Main.elm` will be compiled first even though it most likely does not depend on `AdminHelpers`. elm-watch parses the `import`s of your Elm files to know which files affects which targets, and only recompile what’s needed.
  - **Unfortunate ordering.** When you change `src/Shared.elm` (which is used by both targets), you have to wait for `src/Main.elm` to finish compiling before seeing changes to `src/Admin.elm`. The Elm compiler is fast, but the more targets you have the more it adds up. elm-watch compiles the app you interacted with most recently first.
  - **Error overload.** Running many `elm make` commands in sequence means you might see the same error over and over for shared code. An alternative is to stop on the first failing `elm make`, but then you don’t get to see errors at all for later targets until earlier are solved. elm-watch deduplicates compilation errors, so you don’t see the exact same one twice.

- **Build duplication.** You need to maintain your watcher command, and a separate build command for every target. With elm-watch, your targets are defined in [elm-watch.json](#elm-watchjson) so you can both watch and build for production easily.

- **Hot reloading.** That’s just not doable with an ad-hoc command. Sure, you might find some smooth Web Socket CLI, but you still need to do the code injection in Elm’s compiled JS.

- **Mode switching.** elm-watch makes it super easy to toggle Elm’s debugger, directly from the browser. An ad-hoc command probably means stopping the watcher and restarting with some flag or environment variable set.

### elm-watch vs build tools with Elm support

elm-watch grew out of my frustration with [Parcel], and also [webpack]. Support for other languages than JavaScript and TypeScript always feels a bit like an afterthought in such tools.

[elm-live] and [elm-go] are really cool. Built for Elm and work out of the box so you can get started in no time. I’ve had trouble with bugs, though, and I’ve also outgrown them in bigger projects, with multiple Elm apps.

[esbuild] has an Elm plugin, but not with hot reloading.

I’ve tried [Vite] through the wonderful [vite-elm-template]. Vite seems to get nothing but praise, and the little I’ve used it has been great. I’ve heard the Elm plugin is pretty stable, too. However, it prints the Elm compilation errors in all red, and doesn’t go the extra mile with hot reloading like elm-watch does.

JavaScript build tools come and go, though. By pairing elm-watch with another build tool, rather than having that build tool also take care of Elm, you can avoid changing your Elm setup if you switch tooling for JavaScript.

You can pair elm-watch with either of webpack, Parcel, Vite, esbuild or any other build tool really. I recommend pairing with Vite or esbuild!

1. Set the `"output"`s in elm-watch.json to a place that is served by the dev server of your tool.

2. Link to the built Elm JS in your HTML (as mentioned in [Getting Started](#getting-started)). Ideally, you want your tool to “ignore” that script tag – we don’t want it to spend time analyzing it, just serve that file. This might be a bit tricky depending on how customizable the build tool is. Try it out and see how it goes!

3. When building for production:

   - You might be able to re-use your build tool for minifying the built Elm JS, or you can install a minifier separately and use it in elm-watch [postprocess](#postprocess).
   - You might want to hash the built Elm JS file, and update its link in the HTML to include the hash. If nothing else, you could make a small script that does that and run it after elm-watch and your build tool.

It’s up to you to decide if you think the extra work of pairing a build tool with elm-watch is worth it.

[elm-go]: https://github.com/lucamug/elm-go
[elm-guide-install]: https://guide.elm-lang.org/install/elm.html
[elm-hot]: https://github.com/klazuka/elm-hot
[elm-live]: https://github.com/wking-io/elm-live
[elm-monitor]: https://github.com/layflags/elm-monitor
[elm-npm-package]: https://github.com/elm/compiler/tree/master/installers/npm
[elm-remotedev]: https://github.com/utkarshkukreti/elm-remotedev
[elm-tooling]: https://elm-tooling.github.io/elm-tooling-cli/
[esbuild]: https://esbuild.github.io/
[getting-started-with-elm-watch]: https://www.youtube.com/watch?v=n15nOCZnTac
[globalthis]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis
[parcel]: https://parceljs.org/
[platform.worker]: https://package.elm-lang.org/packages/elm/core/latest/Platform#worker
[port-blocking]: https://fetch.spec.whatwg.org/#port-blocking
[redux devtools]: https://github.com/reduxjs/redux-devtools
[run-pty]: https://github.com/lydell/run-pty/
[vite-elm-template]: https://github.com/lindsaykwardell/vite-elm-template
[vite]: https://vitejs.dev/
[web workers]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
[webpack plugin]: https://webpack.js.org/api/plugins/
[webpack]: https://webpack.js.org/
[worker thread]: https://nodejs.org/api/worker_threads.html
