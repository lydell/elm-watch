// Support Web Workers, where `window` does not exist.
const window = globalThis as unknown as Window;

const error: Error & { elmWatchProxy?: true } = new Error(
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

const existing = window.Elm;
const existingObject =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  typeof existing === "object" && existing !== null ? existing : undefined;

const elmProxy = new Proxy(existingObject ?? {}, {
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver) as unknown;
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

window.Elm = elmProxy;

window.__ELM_WATCH.REGISTER?.({});

export {};
