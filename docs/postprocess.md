---
title: Postprocess
nav_order: 10
---

<!-- prettier-ignore-start -->

# Postprocess
{: .no_toc }

1. TOC
{:toc}

<!-- prettier-ignore-end -->

{: .info }  
ℹ️ Postprocessing is an “advanced” feature. If you’re just starting out – skip it.

This lets you change Elm’s JavaScript output. There are two use cases for this:

- Patch the JS during development as well as in production.
- Minify the JS in production.

Postprocessing requires the [JavaScript API](../javascript-api/). Each target can have a `postprocess` function, which gets Elm’s JS and returns new JS:

```js
// elm-watch.mjs
import { elmWatch } from "elm-watch";

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: "hot",
  targets: [
    {
      name: "Main",
      inputs: ["src/Main.elm"],
      output: "build/main.js",
      postprocess: (code, { compilationMode, runMode }) =>
        code.replace(/'apple'/g, "'banana'"),
    },
  ],
});
```

The goal of the postprocessing feature is to be an easier way of transforming Elm’s JavaScript output than learning how to write for example a [webpack plugin]. It’s essentially just a `String -> String` function, while still giving you full control.

Type definition (`import type { Postprocess } from "elm-watch"`):

```ts
type Postprocess = (
  code: string,
  info: {
    compilationMode: "debug" | "standard" | "optimize";
    runMode: "hot" | "make";
  },
) => string | Promise<string>;
```

- `code` is Elm’s JS output.
- `info.compilationMode` lets you for example only minify in optimize mode.
- `info.runMode` is either `"make"` or `"hot"`. I recommend doing the same work for both modes, but in case that’s not feasible you have the possibility.
- Return the new JS, or a promise of it.
- Throw an error (or return a rejected promise) on failure. elm-watch shows the error just like a compilation error.
- Don’t do any side effects. Think of your function as a `String -> String` pure function.

Since postprocess is per target, you don’t get the target name as a parameter – you already know which target the function is for. To use the same function for several targets, define it once and refer to it from each target. If it needs to behave differently for some targets, either use different functions, or create the function with a little helper that takes the target name.

## Example

```js
// elm-watch.mjs
import * as swc from "@swc/core";
import { elmWatch } from "elm-watch";

function patch(code) {
  // Silly example of patching the output, which just changes all occurrences of
  // the string 'apple' to 'banana'.
  return code.replace(/'apple'/g, "'banana'");
}

async function postprocess(code, { compilationMode }) {
  switch (compilationMode) {
    case "standard":
    case "debug":
      return patch(code);

    case "optimize":
      return (await swc.minify(patch(code), { compress: true, mangle: true }))
        .code;
  }
}

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: process.argv[2] === "make" ? "make" : "hot",
  compilationMode: process.argv.includes("--optimize")
    ? "optimize"
    : "standard",
  targets: [
    {
      name: "App",
      inputs: ["src/App.elm"],
      output: "build/app.js",
      postprocess,
    },
    {
      name: "Admin",
      inputs: ["src/Admin.elm"],
      output: "build/admin.js",
      postprocess,
    },
  ],
});
```

## Performance

Your postprocess function runs in the same thread as elm-watch itself. Simple things like a few `.replace()` calls are very fast. But if you do heavy, synchronous work, elm-watch can’t do anything else in the meantime – such as updating the terminal UI or talking to the browser.

Minifiers like [SWC] and [esbuild] do their work on other threads, so they don’t have this problem. Also, you probably only minify in optimize mode, which you rarely use while developing.

Postprocessing for several targets runs in parallel (as long as your function is async – like when using a minifier that runs on another thread).

## Warning: “Bricked” setup

Doing string replacements on source code is very easy to mess up! You will probably end up with syntax errors on your first attempts.

{: .warning }  
⚠️ Syntax errors might “brick” your setup!

At first, elm-watch’s browser UI shows “⛔️ Eval error” and in the browser console you’ll see the syntax error. But if you refresh the page, you’ll load a JavaScript file with syntax errors in it, which means none of it will run! That includes the extra JavaScript code that elm-watch injects for its browser UI and for connecting via WebSocket, which in turn means that elm-watch thinks it can skip compiling your target (since no page has connected via WebSocket) and only typecheck it. Basically, it’ll feel like elm-watch has stopped working no matter what you do.

The only way to “unbrick” the situation is to:

1. Remove the output JavaScript file.
2. Cause a recompile, by re-saving an Elm file, or by restarting elm-watch (saving your entrypoint file makes `node --watch` restart it).

elm-watch has no good way of detecting this situation, so manually removing the output JavaScript file is an important trick to remember.

In summary:

- Resist the urge to refresh the page while working on your postprocess function. You’ll get more help from elm-watch if you don’t.
- If you do, know how to “unbrick”.

{: .info }  
Debugging tip: `console.log` in your postprocess function competes with elm-watch’s terminal output. Instead, throw an error with the information you’re after: `throw new Error(JSON.stringify(myDebugStuff))`. Then elm-watch reports it.

## Migrating from elm-watch 1

In elm-watch 1, postprocess was configured in `elm-watch.json` with `"postprocess"`, which could run any command (reading stdin and writing stdout), or a Node.js file via `elm-watch-node` in a worker thread. elm-watch 2 instead uses a function per target, which is both simpler and more flexible. `"postprocess"` in `elm-watch.json` is now an error.

If you used `elm-watch-node`, you can keep your postprocess file and adapt it to the new function signature in your entrypoint:

```js
// elm-watch.mjs
import { elmWatch } from "elm-watch";
import oldPostprocess from "./postprocess.js";

function postprocessFor(targetName) {
  return (code, { compilationMode, runMode }) =>
    oldPostprocess({
      code,
      targetName,
      compilationMode,
      runMode,
      argv: [],
    });
}

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: process.argv[2] === "make" ? "make" : "hot",
  targets: [
    {
      name: "Main",
      inputs: ["src/Main.elm"],
      output: "build/main.js",
      postprocess: postprocessFor("Main"),
    },
  ],
});
```

If you used another command, like a bash script, either rewrite it in JavaScript (preferably), or spawn it from your postprocess function with [child_process.spawn], writing the code to its stdin and reading its stdout.

## Postprocess notes

You might wonder why minifying for production is a concern for elm-watch, which tries to focus _only_ on Elm. Couldn’t you just minify yourself after running `elm-watch make`?

- Well, you _could,_ but minifiers can be slow so running in parallel is important. But annoying to code! So you’re probably not going to do it.
- elm-watch needs postprocessing anyway for patching during development.
- I think it’s nice to be able to easily test your minified code. With elm-watch, it’s one click away.

Apart from minifying, you might be tempted to also cache-bust the JS files by putting a hash of their content in the file name. For example: `main.js` ➡️ `main.50f612.js`. It’s not a good idea to do that _in the postprocess function,_ though. While you might get away with creating the files as a side effect in your postprocess function, you also want to keep track of them all in one place and update HTML files pointing to them. Since postprocessing runs in parallel, that can be tricky to do correctly. I suggest doing that as a separate step afterwards – for example in your entrypoint after `await elmWatch(...)` in make mode. elm-watch assumes that your function is pure, so if you do things that makes that assumption not hold you’re on your own.

[child_process.spawn]: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
[esbuild]: https://esbuild.github.io/
[swc]: https://swc.rs/
[webpack plugin]: https://webpack.js.org/api/plugins/
