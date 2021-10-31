import { CompilationModeWithProxy } from "../client/WebSocketMessages";
import * as ClientCode from "./ClientCode";
import * as Errors from "./Errors";
import { absoluteDirname, AbsolutePath } from "./PathHelpers";
import { Port } from "./Port";
import { CompilationMode, OutputPath } from "./Types";

type Replacement = {
  // The `probe` is a simpler regex that determines if `replacements` should be
  // run. All the `replacements` are required to make a change.
  probe: RegExp;
  replacements: Array<{
    search: RegExp;
    replace: string;
  }>;
};

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

// All regexes are anchored to the beginning of lines, which should make it
// impossible to match within strings in the user’s program.
const mainReplacements: Array<Replacement> = [
  // ### _Platform_initialize (main : Program flags model msg)
  // New implementation (copy-paste with some changes and additions).
  {
    probe: /^function _Platform_initialize\(/m,
    replacements: [
      {
        search:
          /^function _Platform_initialize\(flagDecoder, args, init, update, subscriptions, stepperBuilder\)\r?\n\{(?:\r?\n(?:[\t ][^\n]+)?)+\r?\n\}/m,
        replace: `
function _Platform_initialize(programType, flagDecoder, args, init, impl, stepperBuilder)
{
  if (args === "__elmWatchReturnImpl") {
    return [impl, programType];
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
    stepper(model, true /* isSync */);
    _Platform_enqueueEffects(managers, _Platform_batch(_List_Nil), subscriptions(model));
  }

  return Object.defineProperties(
    ports ? { ports: ports } : {},
    {
      __elmWatchHotReload: { value: __elmWatchHotReload },
      __elmWatchProgramType: { value: programType },
    }
  );
}
        `.trim(),
      },
    ],
  },

  // ### _VirtualDom_init (main : Html msg)
  // New implementation (copy-paste with some changes and additions).
  {
    probe: /^var _VirtualDom_init =/m,
    replacements: [
      {
        search:
          /^var _VirtualDom_init = F4\(function\(virtualNode, flagDecoder, debugMetadata, args\)\r?\n\{(?:\r?\n(?:[\t ][^\n]+)?)+\r?\n\}\);/m,
        replace: `
var _VirtualDom_init = F4(function(virtualNode, flagDecoder, debugMetadata, args) {
  var programType = "Html";

  if (args === "__elmWatchReturnImpl") {
    return [virtualNode, programType];
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

  return Object.defineProperties(
    ports ? { ports: ports } : {},
    {
      __elmWatchHotReload: { value: __elmWatchHotReload },
      __elmWatchProgramType: { value: programType },
    }
  );
});
        `.trim(),
      },
    ],
  },

  // ### _Platform_export
  // New implementation (inspired by the original).
  {
    probe: /^function _Platform_export\(/m,
    replacements: [
      {
        search:
          /^function _Platform_export\(exports\)\r?\n\{(?:\r?\n(?:[\t ][^\n]+)?)+\r?\n\}/m,
        replace: `
function _Platform_export(exports) {
  var errored = _Platform_mergeExportsElmWatch('Elm', scope['Elm'] || (scope['Elm'] = {}), exports);
  if (errored) {
    throw new Error("elm-watch: Encountered errors on load or hot reload. See earlier errors in the console.");
  }
}

function _Platform_mergeExportsElmWatch(moduleName, obj, exports) {
  var errored = false;
  for (var name in exports) {
    if (name === "init") {
      if ("init" in obj) {
        if ("__elmWatchApps" in obj) {
          var [newImpl, programType] = exports.init("__elmWatchReturnImpl");
          for (var app of obj.__elmWatchApps) {
            if (app.__elmWatchProgramType !== programType) {
              errored = true;
              Promise.reject(new Error(\`elm-watch: Cannot hot reload because \\\`\${moduleName}.main\\\` changed from \\\`\${app.__elmWatchProgramType}\\\` to \\\`\${programType}\\\`. You need to reload the page!\`));
            }
            try {
              app.__elmWatchHotReload(newImpl);
            } catch (error) {
              errored = true;
              Promise.reject(new Error(\`elm-watch: Error during hot reload for \\\`\${moduleName}\\\`: \${error}\`));
            }
          }
        } else {
          errored = true;
          Promise.reject(new Error(\`elm-watch: \\\`\${moduleName}.init\\\` exists but wasn't created by elm-watch. Maybe a duplicate script is getting loaded accidentally? If not, rename one of them so I know which is which!\`));
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
      var innerErrored = _Platform_mergeExportsElmWatch(moduleName + "." + name, obj[name] || (obj[name] = {}), exports[name]);
      if (innerErrored) {
        errored = true;
      }
    }
  }
  return errored;
}
        `.trim(),
      },
    ],
  },

  // ### _Browser_application
  // Don’t pluck things out of `impl`. Pass `impl` to `_Browser_document`.
  {
    probe: /^function _Browser_application\(/m,
    replacements: [
      {
        search: /^\s*var onUrlChange = impl\.onUrlChange;/m,
        replace: ``,
      },
      {
        search: /^\s*var onUrlRequest = impl\.onUrlRequest;/m,
        replace: ``,
      },
      {
        search:
          /^(\s*)var key = function\(\) \{ key\.a\(onUrlChange\(_Browser_getUrl\(\)\)\); \};/m,
        replace: `$1var key = function() { key.a(impl.onUrlChange(_Browser_getUrl())); };`,
      },
      {
        search: /^(\s*)sendToApp\(onUrlRequest\(/m,
        replace: `$1sendToApp(impl.onUrlRequest(`,
      },
      {
        search:
          /^(\s*)view: impl\.view,\s*update: impl\.update,\s*subscriptions: impl.subscriptions$/m,
        replace: `$1impl`,
      },
    ],
  },

  // ### $elm$browser$Browser$sandbox
  // Don’t pluck `view` from `impl`. Pass `impl` to `_Browser_element`.
  {
    probe: /^var \$elm\$browser\$Browser\$sandbox =/m,
    replacements: [
      {
        search: /^(\s*)view: impl\.view$/m,
        replace: "$1view: (model) => impl.view(model),\n$1impl",
      },
    ],
  },

  // ### _Platform_worker, _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Update call to `_Platform_initialize` to match our implementation.
  // `_Browser_application` calls `_Browser_document`/`_Debugger_document`.
  // `$elm$browser$Browser$sandbox` calls `_Browser_element`/`_Debugger_element`.
  // In those cases we need `impl.impl`.
  // Also pass the type of program to `_Platform_initialize`.
  {
    probe:
      /^var (?:_Platform_worker|_Browser_element|_Browser_document|_Debugger_element|_Debugger_document) =/m,
    replacements: [
      {
        search:
          /^(\s*)impl\.update,\s*impl\.subscriptions,|\$elm\$browser\$Debugger\$Main\$wrapUpdate\(impl\.update\),\s*\$elm\$browser\$Debugger\$Main\$wrapSubs\(impl\.subscriptions\),/gm,
        replace: `$1impl.impl || impl,`,
      },
    ],
  },
  {
    probe: /^var _Platform_worker =/m,
    replacements: [
      {
        search:
          /^var _Platform_worker =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&"Platform.worker",`,
      },
    ],
  },
  {
    probe: /^var (?:_Browser_element|_Debugger_element) =/m,
    replacements: [
      {
        search:
          /^var (?:_Browser_element|_Debugger_element) =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&impl.impl ? "Browser.sandbox" : "Browser.element",`,
      },
    ],
  },
  {
    probe: /^var (?:_Browser_document|_Debugger_document) =/m,
    replacements: [
      {
        search:
          /^var (?:_Browser_document|_Debugger_document) =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&impl.impl ? "Browser.application" : "Browser.document",`,
      },
    ],
  },

  // ### _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Don’t pluck `view` from `impl`.
  {
    probe:
      /^var (?:_Browser_element|_Browser_document|_Debugger_element|_Debugger_document) =/m,
    replacements: [
      {
        search: /^\s*var view = impl\.view;/gm,
        replace: ``,
      },
      {
        search: /^([^'"\n]* )view\(/gm,
        replace: `$1impl.view(`,
      },
    ],
  },
];

export function inject(
  outputPath: OutputPath,
  compiledTimestamp: number,
  compilationMode: CompilationMode,
  webSocketPort: Port,
  code: string
): InjectResult {
  // Put our code inside Elm’s IIFE so that minification relying on removing
  // Elm’s IIFE still works.
  const clientCodeReplacement: Replacement = {
    probe: /^\s*'use strict';/m,
    replacements: [
      {
        search: /^\s*'use strict';/m,
        replace: `$&\n${getClientCode(
          outputPath,
          compiledTimestamp,
          compilationMode,
          webSocketPort
        )}`,
      },
    ],
  };
  try {
    const newCode = mainReplacements
      .concat(clientCodeReplacement)
      .reduce(
        (accCode, replacement) =>
          strictReplace(
            absoluteDirname(outputPath.theOutputPath),
            accCode,
            replacement
          ),
        code
      );
    return {
      tag: "Success",
      code: newCode,
    };
  } catch (unknownError) {
    if (unknownError instanceof StrictReplaceError) {
      return unknownError.error;
    }
    throw unknownError;
  }
}

class StrictReplaceError extends Error {
  constructor(public error: InjectError) {
    super();
  }
}

function strictReplace(
  cwd: AbsolutePath,
  code: string,
  { probe, replacements }: Replacement
): string {
  return probe.test(code)
    ? replacements.reduce((accCode, { search, replace }) => {
        const newCode = accCode.replace(search, replace);
        if (newCode === accCode) {
          throw new StrictReplaceError({
            tag: "InjectSearchAndReplaceNotFound",
            errorFilePath: Errors.tryWriteErrorFile(
              cwd,
              "InjectSearchAndReplaceNotFound",
              "txt",
              replaceErrorContent(probe, search, replace, accCode)
            ),
          });
        }
        return newCode;
      }, code)
    : code;
}

function replaceErrorContent(
  probe: RegExp,
  search: RegExp,
  replace: string,
  code: string
): string {
  return `
Modifying Elm's JS output for hot reloading failed!

### Probe (found):
${probe.toString()}

### Regex to replace (not found!):
${search.toString()}

### Replacement:
${replace}

### Code running replacements on:
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

export function proxyFile(
  outputPath: OutputPath,
  compiledTimestamp: number,
  webSocketPort: Port
): Buffer {
  return Buffer.from(
    `${getClientCode(
      outputPath,
      compiledTimestamp,
      "proxy",
      webSocketPort
    )}\n(${proxyFileIIFE.toString()})(this);`
  );
}

function getClientCode(
  outputPath: OutputPath,
  compiledTimestamp: number,
  compilationMode: CompilationModeWithProxy,
  webSocketPort: Port
): string {
  return ClientCode.code
    .replace(/%TARGET_NAME%/g, outputPath.targetName)
    .replace(/%INITIAL_COMPILED_TIMESTAMP%/g, compiledTimestamp.toString())
    .replace(/%COMPILATION_MODE%/g, compilationMode)
    .replace(/%WEBSOCKET_PORT%/g, webSocketPort.thePort.toString());
}
