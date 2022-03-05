# elm-watch

> `elm make` in watch mode. Fast and reliable.

`elm-watch hot` recompiles whenever your Elm files change and reloads the compiled JS in the browser.

If you’ve ever:

- restarted a watcher because it felt like it stopped working
- been annoyed by bad hot reloading
- gotten tired of waiting for slow compilation

… elm-watch _might_ be for you.

Note that elm-watch is all about Elm. Not HTML, not CSS, not JavaScript, not TypeScript and not serving files or proxying requests. That’s a strength in my opinion, but also something to be aware of. You can’t just replace for example Parcel with elm-watch and expect everything to be taken care of.

## Installation

```
npm install --save-dev elm-watch
```

> ⚠️ Windows is currently not supported. elm-watch was built with Windows in mind from day 1, but since it wasn’t developed on Windows it of course didn’t work on the first try.

## Getting started

Create a file called `elm-watch.json`:

```
npx elm-watch init
```

<!-- prettier-ignore -->
```json
{
    "targets": {
        "MyTargetName": {
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

## What elm-watch _is_

Remember the first time you ran `elm make`? It’s super fast, and has beautiful output. And it’s really stable! If the majority of your code is Elm, why complicate things with extra layers where things can go wrong? elm-watch tries to stay as close as that ideal as possible.

- **Maximum speed.** elm-watch tries to do as little as possible besides running `elm make` for you. Doing less work is always faster!
- [**Hot reloading.**][#hot-reloading] elm-watch tries to reimagine the level of quality of hot reloading. The goal is to never leave you wondering if it worked at all.
- **Beautiful colors.** Elm’s error messages are lovely and colorful. elm-watch takes care to preserve them.
- **Focused output.** elm-watch shows you only what you need, while also letting you know what’s going on at all times! A balancing act.
- **Browser UI.** elm-watch always shows you the latest status in the browser. Switching to `--debug` mode – or even `--optimize` mode – is only a click away.
- **Cache free.** Elm already has a cache – the `elm-stuff/` folder – which is really stable and all you need. Famously one of the hardest things in programming, elm-watch has no extra caching to worry about.
- **Elm centric.** elm-watch puts Elm at the heart. Let’s take advantage of Elm’s unique capabilities, like `elm make --output /dev/null` for super fast type checking of apps you’re not currently focusing on!
- [**Reasonably hackable.**][#postprocess] Ever wanted to adjust Elm’s compiled JS? That’s just a `String -> String` function away for both development and production builds.

## What elm-watch is _not_

- A watcher for other things than Elm files.
- A file server.
- A proxy server.
- A code generator.
- A test runner.

It is tempting to put in simple versions of the above so that you can just run `elm-watch` and get going just like with [Parcel]. But it’s always gonna suck in the end. While it is convenient for small toy projects, you’ll eventually grow out of it. That’ll result in endless feature requests, or you having to set up your own stuff for non-Elm things anyway.

So I like to think of elm-watch more of a “professional” tool. Let elm-watch excel at compiling Elm quickly and reliably, and own the rest of the stack yourself. Have your own development server, your own TypeScript compiler and your own CSS setup or whatever you need.

That being said, it’s not super difficult to set elm-watch up together with other tools. See the [example/](./example) folder for a lean and sweet setup with [esbuild], and [run-pty] for easily starting `elm-watch`, `esbuild` and a dev server in one go.

But if you’re looking for a out-of-the-box setup, try [Parcel] or some other tool with the same goals. Choose your trade-offs.

Some more notes:

- Tests. Can elm-watch check your test files for compilation errors? Not currently. I think `elm-test --watch` might be a better alternative.
- Packages. You can use elm-watch for examples in your package, and that might be enough to typecheck all your package files. Relying on type checking in your editor and occasionally running just `elm make` in the terminal might be enough.
- Output format. elm-watch is basically just `elm-watch make`, so the output format is that you use `window.Elm` to access your Elm programs. It might feel ugly and old-school compared to something like `import Elm from "./elm.js"`, but I think it’s fine. It’s just going to affect one line of your code. It lets you decouple your Elm completely from all JavaScript.

## Ideas for the future

- **Interactive errors.** Filter by target or Elm file. Collapse long code snippets (`case` expressions).
- **Debug redux.** Apart from the standard `--debug` mode, also offer the [Redux DevTools] just one click away. Like [elm-monitor] and [elm-remotedev] but with no extra setup.
- **Rust rewrite.** While I’ve kept the dependencies to a bare minimum, it would be super nice with a lean, super resource efficient, stand-alone binary. Most of elm-watch’s tests are written at a very high level, so they should be reusable with an implementation written in any language with too much work.

## elm-watch.json

An `elm-watch.json` is required to be able to use `elm-watch`.

It looks like this:

```ts
type NonEmptyArray<T> = [T, ...Array<T>];

type ElmWatchJson = {
  postprocess?: NonEmptyArray<string>;
  port?: number;
  targets: Record<
    string,
    {
      inputs: NonEmptyArray<string>;
      output: string;
    }
  >;
};
```

Example:

<!-- prettier-ignore -->
```json
{
    "postprocess": ["elm-watch-node", "postprocess.js"],
    "port": 9876,
    "targets": {
        "MyTargetName": {
            "inputs": [
                "src/Main.elm"
            ],
            "output": "build/main.js"
        }
    }
}
```

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| [postprocess][#postprocess] | `NonEmptyArray<string>` | x | A command to run after each `elm make` to transform Elm’s JavaScript output. |
| port | `number` | An arbitrary available port. | In case you _have_ to have the exact same port every time. Note that [some ports cannot be used][port-blocking]]. |
| [targets][#targets] | `Record<string, object>` | _Required_ | The input Elm files to compile and the output JavaScript files to write to. At least one target is required. |

### postprocess

This lets you change Elm’s JavaScript output. There are two use cases for this:

- Patch the JS during development as well as in production.
- Minify the JS in production.

The `"postprocess"` field is a non-empty array, describing a command to run. The first item is the name of the command to spawn: It’s looked up in `PATH`, falling back to being relative to `elm-watch.json`. The remaining items are simply arguments to pass to the spawned command. Note: The arguments are just strings, not `bash` code or something like that. The command is run with CWD set to the `elm-watch.json` directory.

Apart from the specified arguments, elm-watch appends some more, in this order:

1. Target name. One of the keys of the `"targets"` object. This let’s you apply more time consuming minification for a customer facing app than for an internal one, for example.
2. Compilation mode. Either `"debug"`, `"standard"` or `"optimize"`. This lets you only minify in `--optimize` mode, for example.
3. Run mode. Either `"make"` or `"hot"`. I recommend doing the same work for both modes, but in case that’s not feasible you have the possibility.

The command is expected to:

1. Read stdin. You get Elm’s JS as input.
2. Write to stdout. Write transformed JS as output.
3. Exit with code 0. Otherwise an error will be reported, with stdout and stderr printed.
4. Not do any side effects. Think of your command as a `String -> String` pure function.

You might wonder why minifying for production is a concern for elm-watch, which tries to focus _only_ on Elm. Couldn’t you just minify yourself after running `elm-watch make`?

- Well, you _could,_ but minifiers can be slow so running in parallel is important. But annoying to code! So you’re probably not going to do it.
- elm-watch needs parallel postprocessing anyway for patching during development.
- I think it’s nice to be able to easily test your minified code. With elm-watch, it’s one click away.

> Apart from minifying, you might be tempted to also cache-bust the JS files by putting a hash of their content in the file name. For example: `main.js` ➡️ `main.50f612.js`. That’s not a good idea, though. While you might get away with creating the files, but you also want to keep track of them all in one place and update HTML files pointing to them. Since all postprocess commands run in parallel, that can be tricky to do correctly. Unlike minifying, hashing and updating HTML files should be fast, so I suggest doing that as a separate step afterwards. elm-watch assumes that your command is pure, so if you do things that makes that assumption not hold you’re on your own.

#### elm-watch-node

It might be tempting to write your postprocessing in Node.js:

- You already have it installed since elm-watch is built on it.
- It might be easier to write than for example `bash`.
- It’s cross platform.
- You might want to call an `npm` package in your postprocessing.

However, **it’s slow to boot.** Around 100 ms of penalty even for the simplest of scripts. It might not sound like much, but it’s not nice for hot reloading. Compare that to `bash` which runs in more like 1 ms.

To avoid the slowness, elm-watch has a trick up its sleeve: `elm-watch-node`. In your `elm-watch.json`, you can change `"postprocess": ["node", "postprocess.js"]` to `"postprocess": ["elm-watch-node", "postprocess.js"]` and it’s basically the same but faster. The difference is that `elm-watch-node` runs in a [worker thread] instead of as a separate process. Workers are faster to spawn (around 50 ms), but it’s a one time cost. Once started, they can be reused infinitely, resulting in almost no overhead at all.

Here are the differences compared to `node`.

- The first argument _has_ to be the file to run. No other flags or arguments to `node` are supported.

- Your code runs in the same process (but on a thread) as elm-watch, so you don’t get an isolated environment. No shenanigans!

- Instead of using stdin, stdout, process arguments and exit codes you just provide a good old function (see below).

The function must look like so:

```ts
(
    args: [
        code: string,
        ...extraArgs: string[],
        targetName: string,
        compilationMode: "debug" | "standard" | "optimize",
        runMode: "make" | "hot"
    ]
) => string | Promise<string>
```

Use `module.exports = async function() {}` (CJS) or `export default function() {}` (MJS). Note: It’s up to you to configure Node.js to accept CJS or MJS like any Node.js project. elm-watch simply `import()`s your script, so that’s the interface you have to work with.

- Instead of looking at `process.argv`, look at the single `args` array passed to your function.
- Instead of reading `process.stdin`, look at the 0th elements of `args`.
- Instead of writing to `process.stdout`, return a string. (Or a `Promise<string>`.)
- Instead of using `process.exitCode = code` or `process.exit(code)`, return a number (`return code`).

> Note: `elm-watch-node` is only available because elm-watch happens to be written in Node.js. An implementation written in another language is not expected to embed a JavaScript runtime just to implement `elm-watch-node`. In such a case you will have to make do with some other faster scripting language (like `bash`), or pay the penalty of starting `node` every time.

### targets

There isn’t much to say about `"targets"` really. You define what elm-watch should compile.

- inputs: `NonEmptyArray<string>`. List of `.elm` files, relative to `elm-watch.json`. You probably only need one input, but multiple is supported (since `elm make` does).
- output: `string`. A `.js` file, relative to `elm-watch.json`. Unlike `elm make`, only `.js` is supported (and `.html` isn’t). Once you reach for elm-watch, you’re ready to be in charge of your own HTML file.

## Hot reloading

Some exciting features:

- **Scroll position.** Hot reloading is just like another regular Elm rerender in elm-watch. Scroll position (and other subtle DOM state) is kept.
- **Full reloads.** When not possible to hot reload, elm-watch reloads the full page for you. It also tells you why in the browser console.
- **Complete coverage.** Whatever Elm `Program` type you choose or what change you make, the hot reloading always does the right thing.

Hot reloading is essentially a hack. But a pretty good one. As long as hot reloading isn’t built into Elm itself, it’s always going to be a hack and not 100 % perfect:

- Changes to `Model`. Hot reloading is all about running new code with the previous state. That only works if the previous state is compatible – otherwise your `update` and `view` might throw errors. Elm actually has a way to tell if `Msg` has changed, as part of the Import/Export feature in the debugger. If hot reloading were built into Elm, the same could be used to diff the `Model`. elm-watch instead tries to detect that by running the updated `init` function. If it returns something different than last time it can mean:

  - That you tweaked a value. Like changing `velocity = 5` to `velocity = 10`. elm-watch detects that, and reloads the page so you can try out the new initial state.
  - That you changed the `Cmd`s returned. elm-watch detects that too, and again reloads the page so you can try them out.
  - That you added, removed or renamed a field in a record. That’s a very common change, and easy to detect! elm-watch reloads the page since model and functions aren’t compatible.
  - That you changed a type from for example `Int` to `String`. elm-watch can detect it.
  - That you changed things with a custom type. This is where it gets tricky. Let’s say you changed from `Maybe Int` to `Maybe String`, but in `init` you always start with `Nothing`. elm-watch will have no clue about the change! However, if your `view` function immediately throws an error due to trying to use a number as a string, elm-watch catches that and reloads the page for you so you don’t waste time in a broken environment. This is where a full `Model` type-wise diff would be needed.

- Code complexity. If hot reloading was built into Elm, the generated JavaScript could be altered to be easier to hot reload. elm-watch has to bend over backwards a bit to adjust the generated JavaScript after it has been generated instead. It’s a bit of regex replacements, as well as replacements for whole functions. Regex might sound brittle, but luckily Elm’s generated JavaScript is very predictable. While it’s impossible to do safe replacements on input that can be _any_ JavaScript (written by a human), it’s actually 100% safe on Elm’s machine written JavaScript. There are no tricky comments that can fool the regexes, and no multiline strings. (`"""` strings are compiled to single lines with `\n`s in them.) And all your functions and variables are prefixed, so they can’t be confused with core functions. By anchoring all regexes to beginnings of lines – and having heaps of tests – elm-watch can ensure it never messes with _your_ code. That’s great because regex is _fast._ Hot reloading isn’t hot if it’s slow.

- You need a recent enough elm/core version. Otherwise some regexes don’t match. Perfect time to update!

In case you’re wondering, elm-watch has its own hot reloading implementation, built with Elm’s needs at the core. In other words, elm-watch is _not_ using the common [elm-hot] package (which is more focused on fitting into the hot reloading systems of webpack and Parcel).

## HTTPS

**TL;DR:** Use `http://` for local development if you can and spare you the pain.

I’d say it’s the most common to use plain old `http://` when working on `localhost`. One could argue that `https://` would be better even for local development since it’s closer to your production environment (which most likely uses `https://`). To be honest, I’ve tried using `https://` for local development and can’t remember a single time it saved me from a bug. Instead it just complicates things with certificates.

With elm-watch HTTPS causes a new complexity. elm-watch uses Web Sockets for hot reloading. So now there’s the question of `ws://` vs `wss://`. Here are my findings last time I dove into this:

- `ws://` works fine on `https://localhost` in both Chrome and Firefox these days.
- However, Safari Desktop requires `wss://`.
- You can use a self-signed certificate (but get security prompts in the browser). If you set up your `https://` and `wss://` with the same certificate, it works seamlessly.
- …except that Firefox requires you to separately visit the `wss://` origin and accept the unsafe certificate, which is very non-intuitive.
- Safari for iOS does not seem to allow self-signed certificates for websocket at all.

In short, you _can_ use a simple `ws://` together with `https://` in _some_ cases. But to get things working all the time, you would have to create a certificate and add it to your computer OS and phone OS so it becomes trusted for real. Which is a bit annoying. If you are doing that and would like to be able to configure elm-watch to use that certificate as well (with `wss://`), please let me know!

[elm-hot]: https://github.com/klazuka/elm-hot
[elm-monitor]: https://github.com/layflags/elm-monitor
[elm-remotedev]: https://github.com/utkarshkukreti/elm-remotedev
[esbuild]: https://esbuild.github.io/
[parcel]: https://parceljs.org/
[port-blocking]: https://fetch.spec.whatwg.org/#port-blocking
[redux devtools]: https://github.com/reduxjs/redux-devtools
[run-pty]: https://github.com/lydell/run-pty/
[worker thread]: https://nodejs.org/api/worker_threads.html
