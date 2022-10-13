---
title: Comparison to other tools
nav_order: 11
---

<!-- prettier-ignore-start -->

# Comparison to other tools
{: .no_toc }

1. TOC
{:toc}

<!-- prettier-ignore-end -->

## elm-watch vs generic watcher tools

There are many CLI programs that let you watch for file changes and then run a given command. So you could listen for changes to `.elm` files (as well as `elm.json`) and have `elm make src/Main.elm --output build/main.js` as the command to run. Can’t get much simpler, right? What does elm-watch bring to the table then? Here are some interesting points to better understand what value elm-watch can bring:

- **Timing control.** What happens when files change faster than `elm make` runs? Like, if you happen to save a lot in the editor, refactor across files or switch git branches? Maybe the `elm make` calls queue up – and take a lot of extra time to complete – or maybe some events are dropped and you end up with out-of-date compilation error messages. elm-watch waits a couple of milliseconds after each file change event to let things settle before compiling. And if even more files change while compiling, _one_ new compilation is triggered.

- **Multiple targets.** Your project grows bigger, and suddenly you don’t have just `src/Main.elm` but also `src/Admin.elm` and maybe some other apps. Do you just update the command to `elm make src/Main.elm --output build/main.js; elm make src/Admin.elm --output build/main.js`? Now you have many problems:

  - **Wasteful compilation.** If you change `src/AdminHelpers.elm`, `src/Main.elm` will be compiled first even though it most likely does not depend on `AdminHelpers`. elm-watch parses the `import`s of your Elm files to know which files affects which targets, and only recompile what’s needed.
  - **Unfortunate ordering.** When you change `src/Shared.elm` (which is used by both targets), you have to wait for `src/Main.elm` to finish compiling before seeing changes to `src/Admin.elm`. The Elm compiler is fast, but the more targets you have the more it adds up. elm-watch compiles the app you interacted with most recently first.
  - **Error overload.** Running many `elm make` commands in sequence means you might see the same error over and over for shared code. An alternative is to stop on the first failing `elm make`, but then you don’t get to see errors at all for later targets until earlier are solved. elm-watch deduplicates compilation errors, so you don’t see the exact same one twice.

- **Build duplication.** You need to maintain your watcher command, and a separate build command for every target. With elm-watch, your targets are defined in [elm-watch.json](../elm-watch.json/) so you can both watch and build for production easily.

- **Hot reloading.** That’s just not doable with an ad-hoc command. Sure, you might find some smooth WebSocket CLI, but you still need to do the code injection in Elm’s compiled JS.

- **Mode switching.** elm-watch makes it super easy to toggle Elm’s debugger, directly from the browser. An ad-hoc command probably means stopping the watcher and restarting with some flag or environment variable set.

## elm-watch vs build tools with Elm support

elm-watch grew out of my frustration with [Parcel], and also [webpack]. Support for other languages than JavaScript and TypeScript always feels a bit like an afterthought in such tools.

[elm-live] and [elm-go] are really cool. Built for Elm and work out of the box so you can get started in no time. I’ve had trouble with bugs, though, and I’ve also outgrown them in bigger projects, with multiple Elm apps.

[esbuild] has an Elm plugin, but not with hot reloading.

I’ve tried [Vite] through the wonderful [vite-elm-template]. Vite seems to get nothing but praise, and the little I’ve used it has been great. I’ve heard the Elm plugin is pretty stable, too. However, it prints the Elm compilation errors in all red, and doesn’t go the extra mile with hot reloading like elm-watch does.

JavaScript build tools come and go, though. By pairing elm-watch with another build tool, rather than having that build tool also take care of Elm, you can avoid changing your Elm setup if you switch tooling for JavaScript.

You can pair elm-watch with either of webpack, Parcel, Vite, esbuild or any other build tool really. I recommend pairing with Vite or esbuild!

1. Set the `"output"`s in elm-watch.json to a place that is served by the dev server of your tool.

2. Link to the built Elm JS in your HTML (as mentioned in [Getting Started](../getting-started/)). Ideally, you want your tool to “ignore” that script tag – we don’t want it to spend time analyzing it, just serve that file. This might be a bit tricky depending on how customizable the build tool is. Try it out and see how it goes!

3. When building for production:

   - You might be able to re-use your build tool for minifying the built Elm JS, or you can install a minifier separately and use it in elm-watch [postprocess](../postprocess/).
   - You might want to hash the built Elm JS file, and update its link in the HTML to include the hash. If nothing else, you could make a small script that does that and run it after elm-watch and your build tool.

It’s up to you to decide if you think the extra work of pairing a build tool with elm-watch is worth it.

[elm-go]: https://github.com/lucamug/elm-go
[elm-live]: https://github.com/wking-io/elm-live
[esbuild]: https://esbuild.github.io/
[parcel]: https://parceljs.org/
[vite-elm-template]: https://github.com/lindsaykwardell/vite-elm-template
[vite]: https://vitejs.dev/
[webpack]: https://webpack.js.org/
