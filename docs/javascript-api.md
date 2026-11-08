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
      name: "My target name",
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
  { name: "App", inputs: ["src/App.elm"], output: "build/app.js" },
  { name: "Admin", inputs: ["src/Admin.elm"], output: "build/admin.js" },
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
| env | `Record<string, string \| undefined>` | `process.env` | Environment variables, such as `NO_COLOR`. |
| stdin, stdout, stderr | streams | `process.stdin` etc. | Where elm-watch reads keyboard input and writes output. |

Each target looks like this:

| Field | Type | Description |
| --- | --- | --- |
| name | `string` | Displayed in the terminal UI. Must be unique. |
| inputs | `NonEmptyArray<string>` | `.elm` files, relative to `root`. |
| output | `string` | A `.js` file, relative to `root`. |
| postprocess | `function` | Optional. See [Postprocess](../postprocess/). |

`elmWatch()` returns a promise of an exit code: 0 for success and 1 for errors. Use it with `process.exitCode = await elmWatch(...)`.

The options are validated, and you get an error message if something is wrong – also if you write plain JavaScript instead of TypeScript. You can use `// @ts-check` and JSDoc to get type checking in plain JavaScript files:

```js
// @ts-check
import { elmWatch } from "elm-watch";

/** @type {Array<import("elm-watch").Target>} */
const targets = [];
```

## Generating targets

Some projects have so many targets that they generate `elm-watch.json`. With the JavaScript API, you can compute the targets directly instead. For example, one target per `src/Pages/*.elm` file:

```js
import * as fs from "node:fs";
import { elmWatch } from "elm-watch";

const targets = fs
  .readdirSync(new URL("src/Pages", import.meta.url))
  .filter((file) => file.endsWith(".elm"))
  .map((file) => {
    const name = file.slice(0, -".elm".length);
    return {
      name,
      inputs: [`src/Pages/${file}`],
      output: `build/${name}.js`,
    };
  });

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode: process.argv[2] === "make" ? "make" : "hot",
  targets,
});
```

[node --watch]: https://nodejs.org/api/cli.html#--watch
[util.parseArgs]: https://nodejs.org/api/util.html#utilparseargsconfig
