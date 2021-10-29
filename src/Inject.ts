import * as ClientCode from "./ClientCode";
import * as Errors from "./Errors";
import { AbsolutePath } from "./PathHelpers";

type Replacement = [
  search: RegExp | string,
  replacement: string,
  mode?: "AllowNoMatches" | "RequireMatch"
];

type InjectResult =
  | InjectError
  | {
      tag: "Success";
      code: string;
    };

export type InjectError = {
  tag: "InjectSearchAndReplaceNotFound";
  errorFilePath: Errors.ErrorFilePath;
};

// TODO: Can make these safe? Don’t replace inside strings.
const mainReplacements: Array<Replacement> = [
  // ### _Platform_initialize (main : Program flags model msg)
  // New implementation.
  [
    /^function _Platform_initialize\(flagDecoder, args, init, update, subscriptions, stepperBuilder\)\r?\n\{(\r?\n([\t ][^\n]+)?)+\r?\n\}/m,
    `
function _Platform_initialize(flagDecoder, args, init, impl, stepperBuilder)
{
  if (args === "__elmWatchReturnImpl") {
    return impl;
  }

  var result = A2(_Json_run, flagDecoder, _Json_wrap(args ? args['flags'] : undefined));
  $elm$core$Result$isOk(result) || _Debug_crash(2 /**/, _Json_errorToString(result.a) /**/);
  var managers = {};
  var initPair = init(result.a);
  var model = initPair.a;
  var stepper = stepperBuilder(sendToApp, model);
  var ports = _Platform_setupEffects(managers, sendToApp);
  var update;
  var subscriptions;

  function setUpdateAndSubscriptions() {
    if (typeof $elm$browser$Debugger$Main$wrapUpdate !== "undefined") {
      update = $elm$browser$Debugger$Main$wrapUpdate(impl.update);
      subscriptions = $elm$browser$Debugger$Main$wrapSubs(impl.subscriptions);
    } else {
      update = impl.update;
      subscriptions = impl.subscriptions;
    }
  }

  function sendToApp(msg, viewMetadata) {
    var pair = A2(update, msg, model);
    stepper(model = pair.a, viewMetadata);
    _Platform_enqueueEffects(managers, pair.b, subscriptions(model));
  }

  setUpdateAndSubscriptions();
  _Platform_enqueueEffects(managers, initPair.b, subscriptions(model));

  function __elmWatchHotReload(newImpl) {
    for (var key in newImpl) {
      impl[key] = newImpl[key];
    }
    setUpdateAndSubscriptions();
    stepper(model);
    _Platform_enqueueEffects(managers, _Platform_batch(_List_Nil), subscriptions(model));
  }

  return Object.defineProperty(ports ? { ports: ports } : {}, "__elmWatchHotReload", { value: __elmWatchHotReload });
}
    `.trim(),
  ],

  // ### _VirtualDom_init (main : Html msg)
  // New implementation.
  [
    /^var _VirtualDom_init = F4\(function\(virtualNode, flagDecoder, debugMetadata, args\)\r?\n\{(\r?\n([\t ][^\n]+)?)+\r?\n\}\);/m,
    `
var _VirtualDom_init = F4(function(virtualNode, flagDecoder, debugMetadata, args) {
  if (args === "__elmWatchReturnImpl") {
    return virtualNode;
  }

  var node = args && args['node'] ? args['node'] : _Debug_crash(0);

  function render() {
    node.parentNode.replaceChild(
      _VirtualDom_render(virtualNode, function() {}),
      node
    );
  }

  render();

  function __elmWatchHotReload(newVirtualNode) {
    virtualNode = newVirtualNode;
    render();
  }

  return Object.defineProperty({}, "__elmWatchHotReload", { value: __elmWatchHotReload });
});
    `.trim(),
  ],

  // ### _Platform_export
  // New implementation.
  [
    /^function _Platform_export\(exports\)\r?\n\{(\r?\n([\t ][^\n]+)?)+\r?\n\}/m,
    `
function _Platform_export(exports) {
  _Platform_mergeExportsElmWatch('Elm', scope['Elm'] || (scope['Elm'] = {}), exports);
}
function _Platform_mergeExportsElmWatch(moduleName, obj, exports) {
  for (var name in exports) {
    if (name === "init") {
      if ("init" in obj) {
        if ("__elmWatchApps" in obj) {
          var newImpl = exports.init("__elmWatchReturnImpl");
          for (var app of obj.__elmWatchApps) {
            app.__elmWatchHotReload(newImpl);
          }
        } else {
          _Debug_crash(6, moduleName);
        }
      } else {
        obj.__elmWatchApps = [];
        obj.init = (...args) => {
          var app = exports.init(...args);
          obj.__elmWatchApps.push(app);
          return app;
        };
      }
    } else {
      _Platform_mergeExportsElmWatch(moduleName + "." + name, obj[name] || (obj[name] = {}), exports[name]);
    }
  }
}
    `,
  ],

  // ### _Browser_application
  // Don’t pluck things out of `impl`. Pass `impl` to `_Browser_document`.
  [`var onUrlChange = impl.onUrlChange;`, ``],
  [`var onUrlRequest = impl.onUrlRequest;`, ``],
  [
    `var key = function() { key.a(onUrlChange(_Browser_getUrl())); };`,
    `var key = function() { key.a(impl.onUrlChange(_Browser_getUrl())); };`,
  ],
  [`sendToApp(onUrlRequest(`, `sendToApp(impl.onUrlRequest(`],
  [
    /view: impl\.view,\s*update: impl\.update,\s*subscriptions: impl.subscriptions/g,
    `impl`,
  ],

  // ### $elm$browser$Browser$sandbox
  // Don’t pluck `view` from `impl`. Pass `impl` to `_Browser_element`.
  [/view: impl\.view/g, "view: (model) => impl.view(model), impl"],

  // ### _Platform_worker, _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Update call to `_Platform_initialize` to match our implementation.
  // `_Browser_application` calls `_Browser_document`/`_Debugger_document`.
  // `$elm$browser$Browser$sandbox` calls `_Browser_element`/`_Debugger_element`.
  // In those cases we need `impl.impl`.
  [
    /impl\.update,\s*impl\.subscriptions,|\$elm\$browser\$Debugger\$Main\$wrapUpdate\(impl\.update),\s*\$elm\$browser\$Debugger\$Main\$wrapSubs\(impl\.subscriptions\),/g,
    `impl.impl || impl,`,
  ],

  // ### _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Don’t pluck `view` from `impl`.
  [`var view = impl.view;`, ``],
  [/\bview\(/g, `impl.view(`],
];

const debuggerReplacements: Array<Replacement> = [
  [
    /\$elm\$browser\$Debugger\$Main\$wrapUpdate\(impl\.update\),\s*\$elm\$browser\$Debugger\$Main\$wrapSubs\(impl\.subscriptions\),/g,
    `impl,`,
  ],
];

const debuggerRegex = /^console.warn\(['"]Compiled in DEBUG mode/m;

export function inject(cwd: AbsolutePath, code: string): InjectResult {
  const result1 = runReplacements(cwd, code, mainReplacements);

  switch (result1.tag) {
    case "InjectSearchAndReplaceNotFound":
      return result1;

    case "Success": {
      const result2 = debuggerRegex.test(code)
        ? runReplacements(cwd, result1.code, debuggerReplacements)
        : result1;

      switch (result2.tag) {
        case "InjectSearchAndReplaceNotFound":
          return result2;

        case "Success":
          return {
            tag: "Success",
            code: `${result2.code}\n${ClientCode.code}`,
          };
      }
    }
  }
}

function runReplacements(
  cwd: AbsolutePath,
  code: string,
  replacements: Array<Replacement>
): InjectResult {
  return replacements.reduce<InjectResult>(
    (result, replacement) => {
      switch (result.tag) {
        case "Success":
          return strictReplace(cwd, result.code, replacement);
        case "InjectSearchAndReplaceNotFound":
          return result;
      }
    },
    { tag: "Success", code }
  );
}

function strictReplace(
  cwd: AbsolutePath,
  code: string,
  [search, replacement, mode = "RequireMatch"]: Replacement
): InjectResult {
  const parts = code.split(search);
  return mode === "RequireMatch" && parts.length <= 1
    ? {
        tag: "InjectSearchAndReplaceNotFound",
        errorFilePath: Errors.tryWriteErrorFile(
          cwd,
          "InjectSearchAndReplaceNotFound",
          "txt",
          replaceErrorContent(search, replacement, code)
        ),
      }
    : {
        tag: "Success",
        code:
          typeof search === "string"
            ? parts.join(replacement)
            : code.replace(search, replacement),
      };
}

function replaceErrorContent(
  search: RegExp | string,
  replacement: string,
  code: string
): string {
  return `
Modifying Elm's JS output for hot reloading failed!

### Code to replace (not found!):
${search.toString()}

### Replacement:
${replacement}

### Input code:
${code}
`.trimStart();
}

const proxyFileIIFE = (scope: Record<string, unknown>): void => {
  const error = new Error(
    `
Certain parts of \`window.Elm\` aren't available yet! That's fine though!

\`elm-watch\` has generated a stub file in place of Elm's compiled JS. This is
because until just now, there was no need to spend time on generating JS!

This stub file is now connecting to \`elm-watch\` via WebSocket, letting it know
that it's time to start generating real JS. Once that's done the page should be
automatically reloaded. But if you get compilation errors you'll need to fix
them first.
  `.trim()
  );

  const existing = scope.Elm;
  const existingObject =
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

  scope.Elm = elmProxy;
};

export function proxyFile(): Buffer {
  // TODO: Also inject websocket stuff.
  return Buffer.from(`(${proxyFileIIFE.toString()})(this);`);
}
