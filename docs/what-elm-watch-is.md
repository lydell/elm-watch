---
title: What elm-watch is
nav_order: 3
---

# What elm-watch _is_

Remember the first time you ran `elm make`? It’s super fast, and has beautiful output. And it’s really stable! If the majority of your code is Elm, why complicate things with extra layers where things can go wrong? elm-watch tries to stay as close as that ideal as possible.

- **Maximum speed.** elm-watch tries to do as little as possible besides running `elm make` for you. Doing less work is always faster!
- [**Hot reloading.**](../hot-reloading/) elm-watch tries to reimagine the level of quality of hot reloading. The goal is to never leave you wondering if it worked at all.
- **Beautiful colors.** Elm’s error messages are lovely and colorful. elm-watch takes care to preserve them.
- [**Browser UI.**](../browser-ui/) elm-watch always shows you the latest status in the browser. Switching to `--debug` mode – or even `--optimize` mode – is only a click away.
- **Cache free.** Elm already has a cache – the `elm-stuff/` folder – which is really stable and all you need. Famously one of the hardest things in programming, elm-watch has no extra caching to worry about.
- **Elm centric.** elm-watch puts Elm at the heart. Let’s take advantage of Elm’s unique capabilities, like `elm make --output /dev/null` for super fast type checking of apps you’re not currently focusing on!
- [**Reasonably hackable.**](../postprocess/) Ever wanted to adjust Elm’s compiled JS? That’s just a `String -> String` function away for both development and production builds.
- **Well tested.** elm-watch has 100 % test coverage, save for a few ignore coverage comments. elm-watch is serious about stability.
- **Super scalable.** elm-watch can handle many Elm apps without getting slow. Only the apps you work on get compiled – in most recently used order. The rest are only type checked, which is faster.

👉 See also [Comparison to other tools](../comparison-to-other-tools/).

## Ideas for the future

- **Interactive errors.** Filter by target or Elm file. Collapse long code snippets (`case` expressions).
- **Debug redux.** Apart from the standard `--debug` mode, also offer the [Redux DevTools] just one click away. Like [elm-monitor] and [elm-remotedev] but with no extra setup.
- **Stand-alone binary.** While I’ve kept the npm dependencies for elm-watch to a bare minimum, it would be nice with a lean, super resource efficient, stand-alone binary. Most of elm-watch’s tests are written at a very high level, so they should be reusable with an implementation written in any language with too much work. I’ve been thinking about writing it in Rust, or forking the Elm compiler and building the watcher straight into it (while making no other changes) – which would unlock even more potential, since I can access internals.

[elm-monitor]: https://github.com/layflags/elm-monitor
[elm-remotedev]: https://github.com/utkarshkukreti/elm-remotedev
[redux devtools]: https://github.com/reduxjs/redux-devtools
