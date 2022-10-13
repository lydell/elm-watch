---
title: Hot reloading
nav_order: 6
---

# Hot reloading

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

elm-watch’s hot reloading works by injecting an extra little program into your built JavaScript files (when running `elm-watch hot` only, not `elm-watch make`). It renders the browser UI in the bottom-left corner, and connects to elm-watch’s WebSocket server. You’re not supposed to really notice or have to think any of that, but it can help to know how the “magic” works when debugging things. Or just for fun.

[elm-hot]: https://github.com/klazuka/elm-hot
[parcel]: https://parceljs.org/
[webpack]: https://webpack.js.org/
