---
title: Postprocess
nav_order: 8
---

<!-- prettier-ignore-start -->

# Postprocess
{: .no_toc }

1. TOC
{:toc}

<!-- prettier-ignore-end -->

> ℹ️ Postprocessing is an “advanced” feature. If you’re just starting out – skip it.

This lets you change Elm’s JavaScript output. There are two use cases for this:

- Patch the JS during development as well as in production.
- Minify the JS in production.

The `"postprocess"` field is a non-empty array, describing a command to run. There are two types of commands:

- [External process](#external-process) – run any program written in any language
- [elm-watch-node](#elm-watch-node) – run a Node.js inside the elm-watch process itself for performance

If you’re in a hurry, I recommend going straight to [elm-watch-node](#elm-watch-node), but reading [External process](#external-process) gives the full story. And the next section about “bricking” your setup is well worth the read.

The goal of the postprocessing feature is to be an easier way of transforming Elm’s JavaScript output than learning how to write for example a [webpack plugin]. It’s essentially just a `String -> String` function, while still giving you full control. To push you in the “full control” direction, there are no “shortcuts” for postprocessing in elm-watch – the only way to do it is to write a small script (see the following two sections).

## Warning: “Bricked” setup

Doing string replacements on source code is very easy to mess up! You will probably end up with syntax errors on your first attempts.

**Syntax errors might “brick” your setup!**

At first, elm-watch’s browser UI shows “⛔️ Eval error” and in the browser console you’ll see the syntax error. But if you refresh the page, you’ll load a JavaScript file with syntax errors in it, which means none of it will run! That includes the extra JavaScript code that elm-watch injects for its browser UI and for connecting via WebSocket, which in turn means that elm-watch thinks it can skip compiling your target (since no page has connected via WebSocket) and only typecheck it. elm-watch keeps reacting to changes to your elm-watch-node postprocess file, but won’t run it. Basically, it’ll feel like elm-watch has stopped working no matter what you do.

The only way to “unbrick” the situation is to:

1. Remove the output JavaScript file.
2. Cause a recompile, by re-saving an Elm file or your elm-watch-node postprocess file.

elm-watch has no good way of detecting this situation, so manually removing the output JavaScript file is an important trick to remember.

In summary:

- Resist the urge to refresh the page while working on your postprocess script. You’ll get more help from elm-watch if you don’t.
- If you do, know how to “unbrick”.

## External process

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

## elm-watch-node

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

> Note: `elm-watch-node` is only available because elm-watch happens to be written in Node.js. An [implementation written in another language](./ideas-for-the-future) is not expected to embed a JavaScript runtime just to implement `elm-watch-node`. In such a case you will have to make do with some other faster scripting language (like `bash`), or pay the penalty of starting `node` every time.

## Postprocess notes

You might wonder why minifying for production is a concern for elm-watch, which tries to focus _only_ on Elm. Couldn’t you just minify yourself after running `elm-watch make`?

- Well, you _could,_ but minifiers can be slow so running in parallel is important. But annoying to code! So you’re probably not going to do it.
- elm-watch needs parallel postprocessing anyway for patching during development.
- I think it’s nice to be able to easily test your minified code. With elm-watch, it’s one click away.

Apart from minifying, you might be tempted to also cache-bust the JS files by putting a hash of their content in the file name. For example: `main.js` ➡️ `main.50f612.js`. It’s not a good idea to do that _in the postprocess script,_ though. While you might get away with creating the files as a side effect in your postprocess script, you also want to keep track of them all in one place and update HTML files pointing to them. Since all postprocess commands run in parallel, that can be tricky to do correctly (you’ll probably end up with parallel invocations overwriting each other). I suggest doing that as a separate step afterwards. (Unlike minifying, hashing and updating HTML files should be fast, so no need to worry about parallelization.) elm-watch assumes that your command is pure, so if you do things that makes that assumption not hold you’re on your own.

[webpack plugin]: https://webpack.js.org/api/plugins/
[worker thread]: https://nodejs.org/api/worker_threads.html
