---
title: JavaScript API
nav_order: 9
---

<!-- prettier-ignore-start -->

# JavaScript API
{: .no_toc }

1. TOC
{:toc}

<!-- prettier-ignore-end -->

{: .info }  
ℹ️ For simple projects, [elm-watch.json](../elm-watch.json/) and the `elm-watch` command are all you need. Reach for the JavaScript API when you grow out of that.

Instead of `elm-watch.json` and the `elm-watch` command, you can write a small JavaScript file that imports elm-watch and passes all configuration as options. Since it’s just code, you can compute your targets however you want, [postprocess](../postprocess/) Elm’s output with a function, and [customize the HTTP server](../server/#custom-server). And there are TypeScript types to help you get it right.

{: .info }  
ℹ️ The examples use `import.meta.dirname` (Node.js 20.11 or later) and `node --watch` (stable in Node.js 22).

## Example

```js
// elm-watch.mjs
import { elmWatch } from "elm-watch";

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: "hot",
  targets: [
    {
      type: "application",
      name: "My target name",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "build/main.js",
    },
  ],
});
```

Run it like so:

```
node --watch elm-watch.mjs
```

That’s the same as having this `elm-watch.json` and running `elm-watch hot`:

```json
{
  "targets": {
    "My target name": {
      "type": "application",
      "elmJson": "elm.json",
      "inputs": ["src/Main.elm"],
      "output": "build/main.js"
    }
  }
}
```

When using the JavaScript API, elm-watch does not read `elm-watch.json` at all.

## Getting started

Run `elm-watch init --javascript` to create an `elm-watch.mjs` file. It works just like the `elm-watch` command, including target name filtering and `--debug`/`--optimize`. Then change it however you like!

If you already have an `elm-watch.json`, `elm-watch init --javascript` migrates it: The new file is created next to your `elm-watch.json`, with all your targets and options (and `"postprocess"` from elm-watch 1, turned into a function), and then `elm-watch.json` is removed. Remember to update your `package.json` scripts and CI to run the new file.

Run `elm-watch init --typescript` to create `elm-watch.mts` instead. Node.js can run TypeScript files directly (by default since Node.js 22.18), by stripping the types. It does not type check, though – use your editor or `tsc` for that. (`elm-watch.mjs` is type checked too, if you have type checking enabled for JavaScript files in your editor, thanks to the `// @ts-check` comment at the top.)

## node --watch

When using `elm-watch.json`, elm-watch restarts itself when you change it. When using the JavaScript API, let Node.js do that instead: [node --watch] restarts your script when it changes, or any file it imports changes (such as a separate file with your postprocess function).

When restarting, elm-watch lets any running `elm` compilations finish first (to avoid corrupting `elm-stuff/`), and the browser reconnects automatically. elm-watch remembers its port between restarts, just like before.

Changes to `elm.json` files are still handled by elm-watch itself, regardless of `--watch`.

## Command line arguments

Your script decides what it does, so there are no special command line arguments. But it’s easy to add the ones you want. Here’s an example that works like the `elm-watch` command, using Node.js’ built-in [util.parseArgs]:

```js
// elm-watch.mjs
import { parseArgs } from "node:util";
import { elmWatch } from "elm-watch";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    debug: { type: "boolean", default: false },
    optimize: { type: "boolean", default: false },
  },
});

// For example: `node elm-watch.mjs make --optimize Admin`
const [runMode = "hot", ...targetNames] = positionals;

const targets = [
  {
    type: "application",
    name: "App",
    elmJson: "elm.json",
    inputs: ["src/App.elm"],
    output: "build/app.js",
  },
  {
    type: "application",
    name: "Admin",
    elmJson: "elm.json",
    inputs: ["src/Admin.elm"],
    output: "build/admin.js",
  },
];

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  targets:
    targetNames.length === 0
      ? targets
      : targets.filter((target) => targetNames.includes(target.name)),
});
```

```
node --watch elm-watch.mjs hot
node elm-watch.mjs make --optimize
node elm-watch.mjs make --optimize Admin
```

Since `targets` is an array, you can filter it in any way you like – no need to learn some special filtering syntax.

## Options

Type definition: `import type { Options } from "elm-watch"`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| root | `string` | _Required_ | Absolute path. Relative paths in the other options are resolved from here, and elm-watch keeps its state in `elm-stuff/elm-watch/` inside it. Usually `import.meta.dirname`. |
| runMode | `"hot" \| "make"` | _Required_ | Like `elm-watch hot` and `elm-watch make`. |
| compilationMode | `"standard" \| "debug" \| "optimize"` | `"standard"` | In `"make"` mode: The compilation mode for all targets. In `"hot"` mode: The compilation mode for targets you haven’t switched to another mode in the [browser UI](../browser-ui/). |
| targets | `Array<Target>` | _Required_ | What to compile. At least one target is required. See below. |
| port | `number` | An arbitrary available port. Tries to re-use the same port as last time. | Like `"port"` in [elm-watch.json](../elm-watch.json/). |
| host | `string` | `"127.0.0.1"` | The host for the server to listen on, as in Node.js’ `server.listen(port, host)`. Use `"0.0.0.0"` to expose the server on the local network. See [Network exposure](../server/#network-exposure). The `ELM_WATCH_HOST` environment variable is ignored. |
| staticFilesDir | `string` | unset | A directory of static files to [serve](../server/), relative to `root`. Like `"serve"` in elm-watch.json. |
| webSocketUrl | `string` | unset | Like `"webSocketUrl"` in elm-watch.json. The `ELM_WATCH_WEBSOCKET_URL` environment variable is ignored – use `process.env` yourself if needed. |
| allowedHosts | `Array<string>` | `[]` | Like `"allowedHosts"` in elm-watch.json. See [Allowed hosts](../server/#allowed-hosts). The `ELM_WATCH_ALLOWED_HOSTS` environment variable is ignored – use `process.env` yourself if needed. |
| createServer | `function` | `http.createServer` | See [Custom server](../server/#custom-server). |
| openEditor | `function` | unset | Called with `{ file, line, column }` when you click an error location in the browser UI. See [Clickable error locations](../browser-ui/#with-the-javascript-api). The `ELM_WATCH_OPEN_EDITOR` environment variable is ignored. |
| signal | `AbortSignal` | unset | Abort to make elm-watch exit (in `"hot"` mode). See [Stopping elm-watch](#stopping-elm-watch). |
| env | `Record<string, string \| undefined>` | `process.env` | Environment variables, such as `NO_COLOR`. |
| stdin, stdout, stderr | streams | `process.stdin` etc. | Where elm-watch reads keyboard input and writes output. |

Each target looks like this (see [targets in elm-watch.json](../elm-watch.json/#targets) for more details):

| Field | Type | Description |
| --- | --- | --- |
| type | `"application" \| "package"` | Application targets compile Elm files with `main` to JavaScript. [Package targets](../elm-watch.json/#package-targets) typecheck a package. |
| name | `string` | Displayed in the terminal UI. Must be unique. |
| elmJson | `string` | The `elm.json` to compile with, relative to `root`. Its `"type"` must match the target’s `type`. Usually `"elm.json"`. |
| inputs | `NonEmptyArray<string>` | Applications only. `.elm` files, relative to `root`. |
| output | `string` | Applications only. A `.js` file, relative to `root`. |
| postprocess | `function` | Applications only. Optional. See [Postprocess](../postprocess/). |

Type definitions: `Target`, `ApplicationTarget` and `PackageTarget`.

`elmWatch()` returns a promise of an exit code: 0 for success and 1 for errors. Use it with `process.exitCode = await elmWatch(...)`.

Optional options can also be set to `undefined`, which is handy for environment variables: `host: process.env.ELM_WATCH_HOST`.

The options are validated, and you get an error message if something is wrong – also if you write plain JavaScript instead of TypeScript. You can use `// @ts-check` and JSDoc to get type checking in plain JavaScript files:

```js
// @ts-check
import { elmWatch } from "elm-watch";

/** @type {Array<import("elm-watch").Target>} */
const targets = [];
```

## Top-level await

`await elmWatch(...)` doesn’t finish until elm-watch exits. Until then, the rest of your file hasn’t run yet. That matters for the functions you pass to elm-watch, such as [postprocess](../postprocess/) functions, since elm-watch calls them while it is running: If they use a `const` or `let` variable that is defined _below_ the `elmWatch` call, you get an error like `ReferenceError: Cannot access 'x' before initialization`. So define everything those functions need _above_ the `elmWatch` call. (Function declarations are hoisted, so they work anywhere – but the variables they use are not.)

Code _after_ `await elmWatch(...)` is useful for things to do once elm-watch is done, such as finishing a production build after `make`. See the [production example](https://github.com/lydell/elm-watch/tree/main/examples/production#readme).

## Generating targets

Some projects have so many targets that they generate `elm-watch.json`. With the JavaScript API, you can compute the targets directly instead. For example, one target per `src/Pages/*.elm` file, using the globs built into Node.js ([fs.globSync], Node.js 22 or later):

```js
import * as fs from "node:fs";
import * as path from "node:path";
import { elmWatch } from "elm-watch";

const targets = fs
  .globSync("src/Pages/*.elm", { cwd: import.meta.dirname })
  .map((file) => {
    const name = path.basename(file, ".elm");
    return {
      type: "application",
      name,
      elmJson: "elm.json",
      inputs: [file],
      output: `build/${name}.js`,
    };
  });

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: process.argv[2] === "make" ? "make" : "hot",
  targets,
});
```

Or one target with many inputs: `inputs: fs.globSync("src/Widgets/*.elm", { cwd: import.meta.dirname })`. (Note that `inputs` must not be empty.)

The glob runs once, when your script starts. If you add or remove files matching the glob, restart your script (or touch it, if you run it with `node --watch`). See also the [asset paths example](https://github.com/lydell/elm-watch/tree/main/examples/asset-paths#readme), which uses `fs.globSync` together with `node --watch-path` to restart automatically when files in a directory change.

## Stopping elm-watch

In `"hot"` mode, elm-watch runs until you press ctrl+c, or until it receives SIGTERM (which `node --watch` sends when restarting). To stop it from code, pass an [AbortSignal] as the `signal` option. Just like for SIGTERM, elm-watch lets running `elm` processes finish before exiting, and the promise returned by `elmWatch()` then resolves to 0.

For example, this makes elm-watch exit when stdin ends, which is useful when running elm-watch from another program that might crash without cleaning up after itself (this used to be the `ELM_WATCH_EXIT_ON_STDIN_END` environment variable):

```js
const controller = new AbortController();
process.stdin.on("end", () => {
  controller.abort();
});
process.stdin.resume();

process.exitCode = await elmWatch({
  // ...
  signal: controller.signal,
});
```

[abortsignal]: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
[fs.globsync]: https://nodejs.org/api/fs.html#fsglobsyncpattern-options
[node --watch]: https://nodejs.org/api/cli.html#--watch
[util.parseArgs]: https://nodejs.org/api/util.html#utilparseargsconfig
