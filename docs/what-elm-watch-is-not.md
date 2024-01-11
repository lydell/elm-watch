---
title: What elm-watch is not
nav_order: 4
---

# What elm-watch is _not_

- A compiler for other things than Elm.
- A watcher for Elm _packages._
- A code generator.
- A test runner.

`elm-watch` ships with what you need to get going with any Elm project. But don’t expect it to do everything that [Parcel] or [Vite] does.

The core of elm-watch is more of a “professional” tool. Let elm-watch excel at compiling Elm quickly and reliably, and own the rest of the stack yourself. Have your own TypeScript compiler and your own CSS setup or whatever you need.

However, there are some things that elm-watch needs anyway – such as an [HTTP server](../server/) – and by exposing just the right amount of it, you get a nice [elm-live]-like experience, both for beginners, and for experienced people with projects that haven’t gotten the most complicated requirements.

That being said, it’s not super difficult to set elm-watch up together with other tools. See the [example/] folder for a lean and sweet setup with [esbuild], and [run-pty] for easily starting `elm-watch`, `esbuild` and a custom dev server in one go.

## Packages

At least for now, elm-watch is focused on Elm **Applications only.** I can think of two other use cases:

- Type checking packages.
- Type checking tests.

In both cases, `elm-test --watch` might be a better alternative. You get to see if your tests pass, too!

For a package, it doesn’t take many tests to reach the point where if the tests compile, the package compiles too. Other than that, relying on type checking in your editor and occasionally running `elm make` (without arguments) in the terminal might be enough. Check out [issue #23] if you’d like to see package support.

[elm-live]: https://github.com/wking-io/elm-live
[esbuild]: https://esbuild.github.io/
[example/]: https://github.com/lydell/elm-watch/tree/main/example#readme
[issue #23]: https://github.com/lydell/elm-watch/issues/23
[parcel]: https://parceljs.org/
[run-pty]: https://github.com/lydell/run-pty/
[vite]: https://vitejs.dev/
