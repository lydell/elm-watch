---
title: elm-watch.json
nav_order: 7
---

# elm-watch.json

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
| [postprocess](../postprocess/) | `NonEmptyArray<string>` | No postprocessing. | A command to run after each `elm make` to transform Elm’s JavaScript output. |
| port | `number` | An arbitrary available port. Tries to re-use the same port as last time you ran elm-watch. | WebSocket port for hot reloading. In case you _have_ to have the exact same port every time. Note that [some ports cannot be used][port-blocking]. |

## targets

There isn’t much to say about `"targets"` really. You define what elm-watch should compile.

It’s an object. They keys can be whatever you want, basically. They’re displayed in the terminal UI. They’re passed to your [postprocess](../postprocess/) script. You can also filter by target substring: `elm-watch make app 🇸🇪` would build only targets containing “app” or “🇸🇪”.

For each target, provide the following:

- inputs: `NonEmptyArray<string>`. List of `.elm` files, relative to `elm-watch.json`. You probably only need one input, but if you’ve ever used `elm make` with multiple inputs – you can do that with elm-watch as well.
- output: `string`. A `.js` file, relative to `elm-watch.json`. Unlike `elm make`, only `.js` is supported (and `.html` isn’t). Once you reach for elm-watch, you’re ready to be in charge of your own HTML file.

[port-blocking]: https://fetch.spec.whatwg.org/#port-blocking
