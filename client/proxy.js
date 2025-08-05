// This file supports being run both as a script and as a module.
// Note that a toplevel `this` is `undefined` in a module.

{
  const error = new Error(
    `
Certain parts of \`window.Elm\` aren't available yet! That's fine though!

\`elm-watch\` has generated a stub file in place of Elm's compiled JS. This is
because until just now, there was no need to spend time on generating JS!

This stub file is now connecting to \`elm-watch\` via WebSocket, letting it know
that it's time to start generating real JS. Once that's done the page should be
automatically reloaded. But if you get compilation errors you'll need to fix
them first.
    `.trim(),
  );

  error.elmWatchProxy = true;

  const existing = this?.Elm;
  const existingObject =
    typeof existing === "object" && existing !== null ? existing : undefined;

  var __ELM_PROXY = new Proxy(existingObject ?? {}, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (value !== undefined) {
        return value;
      }
      throw error;
    },
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
      if (descriptor !== undefined) {
        return descriptor;
      }
      throw error;
    },
    has(target, property) {
      const has = Reflect.has(target, property);
      if (has) {
        return true;
      }
      throw error;
    },
    ownKeys() {
      throw error;
    },
  });
}

globalThis.__ELM_WATCH.REGISTER("%TARGET_NAME%", {});

// In scripts, assign Elm like normal.
if (this !== undefined) {
  this.Elm = __ELM_PROXY;
}

// In ESM, importing something that isn’t exported is an error.
// When ESM-ify:ing Elm’s output, the two most likely export names
// are `default` and `Elm`, so make those available. To not break
// regular scripts (non-ESM), where `export` is a syntax error,
// use this cursed polyglot syntax: https://stackoverflow.com/a/72314371
// If elm-watch users end up wanting different export names, I guess
// the solution would be to run the postprocessing step on the proxy
// files as well. Downsides with that approach are that it’ll take
// a little bit more time, and that the postprocessing user code needs
// to be able to handle code that isn’t the Elm output.
0 && await/2//2; export { __ELM_PROXY as default, __ELM_PROXY as Elm };
