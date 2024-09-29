---
title: What elm-watch is
nav_order: 3
---

# What elm-watch _is_

Remember the first time you ran `elm make`? It’s super fast, and has beautiful output. And it’s really stable! If the majority of your code is Elm, why complicate things with extra layers where things can go wrong? elm-watch tries to stay as close to that ideal as possible.

And do you remember trying out Elm with `elm reactor`? Did it feel easy to get started with, but you quickly grew out of it? elm-watch tries to be a more powerful alternative to `elm reactor` as well.

- **Maximum speed.** elm-watch tries to do as little as possible besides running `elm make` for you. Doing less work is always faster!
- [**Hot reloading.**](../hot-reloading/) elm-watch tries to reimagine the level of quality of hot reloading. The goal is to never leave you wondering if it worked at all.
- **Beautiful colors.** Elm’s error messages are lovely and colorful. elm-watch takes care to preserve them.
- [**Browser UI.**](../browser-ui/) elm-watch always shows you the latest status in the browser. Switching to `--debug` mode – or even `--optimize` mode – is only a click away.
- **Cache free.** Elm already has a cache – the `elm-stuff/` folder – which is really stable and all you need. Famously one of the hardest things in programming, elm-watch has no extra caching to worry about.
- **Elm centric.** elm-watch puts Elm at the heart. Let’s take advantage of Elm’s unique capabilities, like `elm make --output /dev/null` for super fast type checking of apps you’re not currently focusing on!
- **Elm ready.** Includes an optional [server](../server/) that lets you get going with a `Browser.application`.
- [**Reasonably hackable.**](../postprocess/) Ever wanted to adjust Elm’s compiled JS? That’s just a `String -> String` function away for both development and production builds. Want to [extend the server](../server/#what-you-can-do-yourself)? It’s open for modification if you know some plain Node.js.
- **Well tested.** elm-watch has 100 % test coverage, save for a few ignore coverage comments. elm-watch is serious about stability.
- **Super scalable.** elm-watch can handle many Elm apps without getting slow. Only the apps you work on get compiled – in most recently used order. The rest are only type checked, which is faster.

👉 See also [Comparison to other tools](../comparison-to-other-tools/).

## Dreams for the future

- **Interactive errors.** Filter by target or Elm file. Collapse long code snippets (`case` expressions).
- **Elm reactor.** . Imagine a modified Elm binary where `elm reactor` gave you an elm-watch like experience.
