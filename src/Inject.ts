import * as ClientCode from "./ClientCode";
import * as Errors from "./Errors";
import { absoluteDirname } from "./PathHelpers";
import { Port } from "./Port";
import {
  AbsolutePath,
  CompilationMode,
  CompilationModeWithProxy,
  OutputPath,
} from "./Types";

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
// The replacements should make the Elm JS stay strictly ES5 so that minifying
// with esbuild in ES5 works.
const mainReplacements: Array<Replacement> = [
  // ### _Platform_initialize (main : Program flags model msg)
  // New implementation (copy-paste with some changes and additions).
  {
    probe: /^function _Platform_initialize\(/m,
    replacements: [
      {
        search: /^\s*(['"])use strict\1;/m,
        // Make sure these are always defined for easier code in `_Platform_initialize`.
        replace: `$&\nvar _Platform_effectManagers = {}, _Scheduler_enqueue;`,
      },
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
    update = impl.%update% || impl._impl.%update%;
    subscriptions = impl.%subscriptions% || impl._impl.%subscriptions%;
    if (typeof $elm$browser$Debugger$Main$wrapUpdate !== "undefined") {
      update = $elm$browser$Debugger$Main$wrapUpdate(update);
      subscriptions = $elm$browser$Debugger$Main$wrapSubs(subscriptions);
    }
  }

  function sendToApp(msg, viewMetadata) {
    var pair = A2(update, msg, model);
    stepper(model = pair.a, viewMetadata);
    _Platform_enqueueEffects(managers, pair.b, subscriptions(model));
  }

  setUpdateAndSubscriptions();
  _Platform_enqueueEffects(managers, initPair.b, subscriptions(model));

  function __elmWatchHotReload(newImpl, new_Platform_effectManagers, new_Scheduler_enqueue) {
    _Platform_enqueueEffects(managers, _Platform_batch(_List_Nil), _Platform_batch(_List_Nil));
    _Scheduler_enqueue = new_Scheduler_enqueue;

    for (var key in new_Platform_effectManagers) {
      var manager = new_Platform_effectManagers[key];
      if (!(key in _Platform_effectManagers)) {
        _Platform_effectManagers[key] = manager;
        managers[key] = _Platform_instantiateManager(manager, sendToApp);
        if (manager.a) {
          console.info("elm-watch: A new port '" + key + "' was added. You might want to reload the page!");
          manager.a(key, sendToApp)
        }
      }
    }

    for (var key in newImpl) {
      if (key === "_impl" && impl._impl) {
        for (var subKey in newImpl[key]) {
          impl._impl[subKey] = newImpl[key][subKey];
        }
      } else {
        impl[key] = newImpl[key];
      }
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
    var nextNode = _VirtualDom_render(virtualNode, function() {});
    node.parentNode.replaceChild(nextNode, node);
    node = nextNode;
  }

  render();

  function __elmWatchHotReload(newVirtualNode) {
    virtualNode = newVirtualNode;
    render();
  }

  return Object.defineProperties(
    {},
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
          var result = exports.init("__elmWatchReturnImpl");
          var newImpl = result[0];
          var programType = result[1];
          for (var index = 0; index < obj.__elmWatchApps.length; index++) {
            var app = obj.__elmWatchApps[index];
            if (app.__elmWatchProgramType !== programType) {
              errored = true;
              Promise.reject(new Error("elm-watch: Cannot hot reload because \`" + moduleName + ".main\` changed from \`" + app.__elmWatchProgramType + "\` to \`" + programType + "\`. You need to reload the page!"));
            }
            try {
              app.__elmWatchHotReload(newImpl, _Platform_effectManagers, _Scheduler_enqueue);
            } catch (error) {
              errored = true;
              Promise.reject(new Error("elm-watch: Error during hot reload for \`" + moduleName + "\`:\\n" + error + "\\n" + (error ? error.stack : "")));
            }
          }
        } else {
          errored = true;
          Promise.reject(new Error("elm-watch: \`" + moduleName + ".init\` exists but wasn't created by elm-watch. Maybe a duplicate script is getting loaded accidentally? If not, rename one of them so I know which is which!"));
        }
      } else {
        obj.__elmWatchApps = [];
        obj.init = function() {
          var app = exports.init.apply(exports, arguments);
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
        search: /^\s*var onUrlChange = impl\.%onUrlChange%;/m,
        replace: ``,
      },
      {
        search: /^\s*var onUrlRequest = impl\.%onUrlRequest%;/m,
        replace: ``,
      },
      {
        search:
          /^(\s*)var key = function\(\) \{ key\.a\(onUrlChange\(_Browser_getUrl\(\)\)\); \};/m,
        replace: `$1var key = function() { key.a(impl.%onUrlChange%(_Browser_getUrl())); };`,
      },
      {
        search: /^(\s*)sendToApp\(onUrlRequest\(/m,
        replace: `$1sendToApp(impl.%onUrlRequest%(`,
      },
      {
        search:
          /^(\s*)%view%: impl\.%view%,\s*%update%: impl\.%update%,\s*%subscriptions%: impl.%subscriptions%$/m,
        replace: `$1%view%: function(model) { return impl.%view%(model); },\n$1_impl: impl`,
      },
    ],
  },

  // ### $elm$browser$Browser$sandbox
  // Don’t pluck `view` from `impl`. Pass `impl` to `_Browser_element`.
  {
    probe: /^var \$elm\$browser\$Browser\$sandbox =/m,
    replacements: [
      {
        search: /^(\s*)%view%: impl\.%view%$/m,
        replace: `$1%view%: function(model) { return impl.%view%(model); },\n$1_impl: impl`,
      },
    ],
  },

  // ### _Platform_worker, _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Update call to `_Platform_initialize` to match our implementation.
  // `_Browser_application` calls `_Browser_document`/`_Debugger_document`.
  // `$elm$browser$Browser$sandbox` calls `_Browser_element`/`_Debugger_element`.
  // In those cases we need `impl._impl`.
  // Also pass the type of program to `_Platform_initialize`.
  {
    probe:
      /^var (?:_Platform_worker|_Browser_element|_Browser_document|_Debugger_element|_Debugger_document) =/m,
    replacements: [
      {
        search:
          /^(\s*)impl\.%update%,\s*impl\.%subscriptions%,|\$elm\$browser\$Debugger\$Main\$wrapUpdate\(impl\.%update%\),\s*\$elm\$browser\$Debugger\$Main\$wrapSubs\(impl\.%subscriptions%\),/gm,
        replace: `$1impl,`,
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
        replace: `$&impl._impl ? "Browser.sandbox" : "Browser.element",`,
      },
    ],
  },
  {
    probe: /^var (?:_Browser_document|_Debugger_document) =/m,
    replacements: [
      {
        search:
          /^var (?:_Browser_document|_Debugger_document) =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&impl._impl ? "Browser.application" : "Browser.document",`,
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
        search: /^\s*var view = impl\.%view%;/gm,
        replace: ``,
      },
      {
        search: /^([^'"\n]* )view\(/gm,
        replace: `$1impl.%view%(`,
      },
    ],
  },
];

export function inject(outputPath: OutputPath, code: string): InjectResult {
  const recordNames = getRecordNames(code);

  try {
    const newCode = mainReplacements
      .map((replacement) => updateRecordNames(recordNames, replacement))
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

function getRecordNames(code: string): Record<string, string> {
  const match = /^\s*impl\.(\w+),\s*impl\.(\w+),\s*impl\.(\w+),/m.exec(code);

  if (match === null) {
    return {};
  }

  const [
    ,
    init = "init_missing",
    update = "update_missing",
    subscriptions = "subscriptions_missing",
  ] = match;

  const extra = Object.fromEntries(
    Array.from(
      code.matchAll(/^\s*var (\w+) = impl\.(\w+);/gm),
      ([, from = "from_missing", to = "to_missing"]) => [from, to]
    )
  );

  return {
    ...extra,
    init,
    update,
    subscriptions,
  };
}

function updateRecordNames(
  recordNames: Record<string, string>,
  replacement: Replacement
): Replacement {
  return {
    probe: updateRegex(recordNames, replacement.probe),
    replacements: replacement.replacements.map(({ search, replace }) => ({
      search: updateRegex(recordNames, search),
      replace: updateString(recordNames, replace),
    })),
  };
}

function updateRegex(
  recordNames: Record<string, string>,
  regex: RegExp
): RegExp {
  return RegExp(updateString(recordNames, regex.source), regex.flags);
}

function updateString(
  recordNames: Record<string, string>,
  string: string
): string {
  return Object.entries(recordNames).reduce(
    (acc, [from, to]) => acc.split(`%${from}%`).join(to),
    string
  );
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

export function proxyFile(
  outputPath: OutputPath,
  elmCompiledTimestamp: number,
  webSocketPort: Port
): string {
  return `${clientCode(
    outputPath,
    elmCompiledTimestamp,
    "proxy",
    webSocketPort
  )}\n${ClientCode.proxy}`;
}

export function clientCode(
  outputPath: OutputPath,
  elmCompiledTimestamp: number,
  compilationMode: CompilationModeWithProxy,
  webSocketPort: Port
): string {
  return (
    versionedIdentifier(webSocketPort) +
    ClientCode.client
      .replace(/%TARGET_NAME%/g, outputPath.targetName)
      .replace(
        /%INITIAL_ELM_COMPILED_TIMESTAMP%/g,
        elmCompiledTimestamp.toString()
      )
      .replace(/%COMPILATION_MODE%/g, compilationMode)
      .replace(/%WEBSOCKET_PORT%/g, webSocketPort.thePort.toString())
  );
}

// When only typechecking, don’t write a proxy file if:
// - The output exists.
// - And it was created by `elm-watch hot`. (`elm-watch make` output does not contain WebSocket stuff).
// - And it was created by the same version of `elm-watch`. (Older versions could have bugs.)
// - And it used the same WebSocket port. (Otherwise it will never connect to us.)
export function versionedIdentifier(webSocketPort: Port): string {
  return `// elm-watch hot ${JSON.stringify({
    version: "%VERSION%",
    webSocketPort: webSocketPort.thePort,
  })}\n`;
}

// Matches string literals, multiline comments, singleline comments and `.foo`.
// We’re only interested in `.foo` – but only outside strings and comments.
// Copied from: https://github.com/lydell/js-tokens/blob/15439aa6c3a66afa852c3549f8f57076935ead1f/index.coffee
const RECORD_FIELD_REGEX =
  /(['"])(?:(?!\1)[^\\\n\r]|\\(?:\r\n|[^]))*(\1)?|\/\*(?:[^*]|\*(?!\/))*(\*\/)?|\/\/.*|\.[\w$]{1,4}\b/g;

export function getRecordFields(
  compilationMode: CompilationMode,
  code: string
): Set<string> {
  switch (compilationMode) {
    case "debug":
    case "standard":
      return new Set();

    // If the set of accessed record field names changes in optimize mode, we cannot hot reload.
    case "optimize":
      return new Set(
        (code.match(RECORD_FIELD_REGEX) ?? []).filter((string) =>
          string.startsWith(".")
        )
      );
  }
}

export function compareRecordFields(
  oldSet: Set<string>,
  newSet: Set<string>
): boolean {
  return (
    compareRecordFieldsHelper(oldSet) === compareRecordFieldsHelper(newSet)
  );
}

function compareRecordFieldsHelper(set: Set<string>): string {
  return Array.from(set).sort().join(",");
}
