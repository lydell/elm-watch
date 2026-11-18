---
title: elm-watch.json
nav_order: 8
---

# elm-watch.json

An `elm-watch.json` file is required to be able to use the `elm-watch` command. There’s not that much to know about it.

{: .info }  
ℹ️ If you need more flexibility – for example to compute your targets, [postprocess](../postprocess/) Elm’s output or customize the HTTP server – use the [JavaScript API](../javascript-api/) instead of `elm-watch.json`.

You can place it anywhere, basically. elm-watch uses the closest `elm-watch.json` file it finds up the directory tree. You can have a single `elm-watch.json` for several apps with different `elm.json` if you want – each target says which `elm.json` it uses.

The contents of `elm-watch.json` looks like this (TypeScript definition):

```ts
type NonEmptyArray<T> = [T, ...Array<T>];

type ElmWatchJson = {
  port?: number;
  host?: string;
  webSocketUrl?: string;
  serve?: string;
  allowedHosts?: Array<string>;
  targets: {
    [name: string]:
      | {
          type: "application";
          elmJson: string;
          compiler?: "elm" | "lamdera";
          inputs: NonEmptyArray<string>;
          output: string;
        }
      | {
          type: "package";
          elmJson: string;
          compiler?: "elm" | "lamdera";
        };
  };
};
```

Example:

<!-- prettier-ignore -->
```json
{
    "port": 9876,
    "targets": {
        "My target name": {
            "type": "application",
            "elmJson": "elm.json",
            "inputs": [
                "src/Main.elm"
            ],
            "output": "build/main.js"
        },
        "😎 My other target": {
            "type": "application",
            "elmJson": "elm.json",
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
| [targets](#targets) | `Record<string, object>` | _Required_ | What to compile: The input Elm files and the output JavaScript files to write to (or [packages](#package-targets) to typecheck). At least one target is required. |
| port | `number` | An arbitrary available port. Tries to re-use the same port as last time you ran elm-watch. | The port for elm-watch’s HTTP and WebSocket server, used for hot reloading and as a simple file server. In case you _have_ to have the exact same port every time. The port is not remembered: If you remove `"port"` later, elm-watch goes back to the port it used before. Note that [some ports cannot be used][port-blocking]. |
| host | `string` | `"127.0.0.1"` | The host for elm-watch’s HTTP and WebSocket server to listen on. Use `"0.0.0.0"` to expose the server on the local network. See [Network exposure](../server/#network-exposure). The `ELM_WATCH_HOST` environment variable takes precedence. |
| webSocketUrl | `string` | `` `ws://${currentHostname}:${port}/elm-watch` `` (sort of) | This lets you customize how the elm-watch client connects its WebSocket for advanced use cases. You can also use the `ELM_WATCH_WEBSOCKET_URL` environment variable for dynamically setting it (the environment variable takes precedence). The value must be a valid URL starting with `ws:` or `wss:`. |
| serve | `string` | unset | A directory of static files to [serve](../server/). |
| allowedHosts | `Array<string>` | `[]` | Extra host names that elm-watch’s server accepts requests for, in addition to localhost, `*.localhost`, `*.local`, IP addresses and the host of `webSocketUrl`. Exact host names only, like `"dev.example.com"`. You can also use the `ELM_WATCH_ALLOWED_HOSTS` environment variable (comma separated), which is combined with this setting. See [Allowed hosts](../server/#allowed-hosts). |

## Environment variables

Some settings can also be set with environment variables. They are each developer’s own settings, so they take precedence over `elm-watch.json`. An empty environment variable counts as unset, so `ELM_WATCH_HOST= elm-watch hot` ignores an `ELM_WATCH_HOST` set in your shell.

| Environment variable | Relation to `elm-watch.json` |
| --- | --- |
| `ELM_WATCH_HOST` | Overrides `"host"`. |
| `ELM_WATCH_WEBSOCKET_URL` | Overrides `"webSocketUrl"`. Ignored if invalid. |
| `ELM_WATCH_ALLOWED_HOSTS` | Comma separated hosts, combined with `"allowedHosts"`. Invalid hosts are ignored. |
| `ELM_WATCH_OPEN_EDITOR` | Only an environment variable. See [Clickable error locations](../browser-ui/#clickable-error-locations). |
| `NO_COLOR` | Only an environment variable. Disables colored output in the terminal. |

They work the same way with the [JavaScript API](../javascript-api/#environment-variables).

## targets

There isn’t much to say about `"targets"` really. You define what elm-watch should compile.

It’s an object. The keys can be whatever you want, basically. They’re displayed in the terminal UI. You can also filter by target substring: `elm-watch make app 🇸🇪` would build only targets containing “app” or “🇸🇪”.

For each target, provide the following:

- type: `"application"` or `"package"`. Application targets compile Elm files with `main` to JavaScript. [Package targets](#package-targets) typecheck an Elm package.
- elmJson: `string`. The `elm.json` to compile with, relative to `elm-watch.json`. Usually `"elm.json"`, but it can be any `elm.json`, such as `"admin/elm.json"` in a project with several Elm apps. elm-watch runs `elm` in the directory of that `elm.json`. Its `"type"` must match the target’s `"type"`.

Optionally:

- compiler: `"elm"` or `"lamdera"`. Default: `"elm"`. The command to compile with. See [Lamdera compiler](#lamdera-compiler).

Application targets also need:

- inputs: `NonEmptyArray<string>`. List of `.elm` files, relative to `elm-watch.json`. You probably only need one input, but if you’ve ever used `elm make` with multiple inputs – you can do that with elm-watch as well.
- output: `string`. A `.js` file, relative to `elm-watch.json`. Unlike `elm make`, only `.js` is supported (and `.html` isn’t). Once you reach for elm-watch, you’re ready to be in charge of your own HTML file.

Globs (like `"src/Pages/*.elm"`) are not supported in `elm-watch.json`. Use the [JavaScript API](../javascript-api/#generating-targets) instead, where you can use the globs built into Node.js to compute your targets.

## Package targets

A target with `"type": "package"` typechecks an Elm package, like running `elm make` without arguments does: The modules in `"exposed-modules"` and everything they import are typechecked. Package targets have no inputs and no output, so they don’t show up in the browser – only in the terminal. An `elm.json` used by a package target can’t be used by any other target.

To try out your package in the browser while developing it, make an example application with its own `elm.json`, with `"source-directories": ["src", "../src"]`. Then both the package and the example are recompiled when you change the package:

<!-- prettier-ignore -->
```json
{
    "targets": {
        "My package": {
            "type": "package",
            "elmJson": "elm.json"
        },
        "Example": {
            "type": "application",
            "elmJson": "example/elm.json",
            "inputs": [
                "example/src/Main.elm"
            ],
            "output": "example/build/main.js"
        }
    }
}
```

## Lamdera compiler

The [Lamdera] compiler can compile vanilla Elm apps too – you don’t need to use Lamdera’s backend or packages. It comes with improvements to elm/core, elm/browser and elm/virtual-dom, such as built-in [hot reloading](../hot-reloading/#the-lamdera-compiler). Set `"compiler": "lamdera"` to use it:

<!-- prettier-ignore -->
```json
{
    "targets": {
        "My target name": {
            "type": "application",
            "elmJson": "elm.json",
            "compiler": "lamdera",
            "inputs": [
                "src/Main.elm"
            ],
            "output": "build/main.js"
        }
    }
}
```

elm-watch then runs `lamdera make` instead of `elm make`. Your `elm.json` stays the same. You can install the compiler with `npm install --save-dev lamdera`. Targets using the same `elm.json` can use different compilers, for example to try out the Lamdera compiler on one target at a time. See the [lamdera-compiler example].

(Real Lamdera apps, with `Lamdera.frontend` and `Lamdera.backend`, need `lamdera live` and don’t work with elm-watch.)

## Upgrading from elm-watch 1

In elm-watch 1, targets had no `"type"` and `"elmJson"`: elm-watch used the closest `elm.json` to the inputs, and only supported applications. Run `elm-watch init` to add `"type": "application"` and `"elmJson"` to all targets in your `elm-watch.json` automatically.

[lamdera]: https://lamdera.com/
[lamdera-compiler example]: https://github.com/lydell/elm-watch/tree/main/examples/lamdera-compiler
[port-blocking]: https://fetch.spec.whatwg.org/#port-blocking
