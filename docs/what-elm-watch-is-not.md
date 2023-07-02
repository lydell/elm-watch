---
title: What elm-watch is not
nav_order: 4
---

# What elm-watch is _not_

- A watcher for other things than Elm files.
- A watcher for Elm _packages._
- A [proxy server](./server).
- A code generator.
- A test runner.

It is tempting to put in simple versions of the above so that you can just run `elm-watch` and get going just like with [Parcel] or [Vite]. While that’s convenient for small toy projects, you’ll eventually grow out of it. That’ll result in endless feature requests – taking time from the core mission of elm-watch – or you having to set up your own stuff for non-Elm things anyway.

So I like to think of elm-watch more of a “professional” tool. Let elm-watch excel at compiling Elm quickly and reliably, and own the rest of the stack yourself. Have your own TypeScript compiler and your own CSS setup or whatever you need.

That being said, it’s not super difficult to set elm-watch up together with other tools. See the [example/] folder for a lean and sweet setup with [esbuild], and [run-pty] for easily starting `elm-watch`, `esbuild` and a dev server in one go.

At least for now, elm-watch is focused on Elm **Applications only.** I can think of two other use cases:

- Type checking packages.
- Type checking tests.

In both cases, `elm-test --watch` might be a better alternative. You get to see if your tests pass, too!

For a package, it doesn’t take many tests to reach the point where if the tests compile, the package compiles too. Other than that, relying on type checking in your editor and occasionally running `elm make` (without arguments) in the terminal might be enough. Check out [issue #23] if you’d like to see package support.

[esbuild]: https://esbuild.github.io/
[example/]: https://github.com/lydell/elm-watch/tree/main/example#readme
[issue #23]: https://github.com/lydell/elm-watch/issues/23
[parcel]: https://parceljs.org/
[run-pty]: https://github.com/lydell/run-pty/
[vite]: https://vitejs.dev/
