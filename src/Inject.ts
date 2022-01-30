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
function _Platform_initialize(programType, debugMetadata, flagDecoder, args, init, impl, stepperBuilder)
{
  if (args === "__elmWatchReturnData") {
    return { impl: impl, debugMetadata: debugMetadata, flagDecoder : flagDecoder, programType: programType };
  }

  var flags = _Json_wrap(args ? args['flags'] : undefined);
  var flagResult = A2(_Json_run, flagDecoder, flags);
  $elm$core$Result$isOk(flagResult) || _Debug_crash(2 /**/, _Json_errorToString(flagResult.a) /**/);
  var managers = {};
  var initUrl = typeof _Browser_getUrl === "undefined" ? undefined : _Browser_getUrl();
  window.__ELM_WATCH_INIT_URL = initUrl;
  var initPair = init(flagResult.a);
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

  function __elmWatchHotReload(newData, new_Platform_effectManagers, new_Scheduler_enqueue, moduleName) {
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

    for (var key in newData.impl) {
      if (key === "_impl" && impl._impl) {
        for (var subKey in newData.impl[key]) {
          impl._impl[subKey] = newData.impl[key][subKey];
        }
      } else {
        impl[key] = newData.impl[key];
      }
    }

    var newFlagResult = A2(_Json_run, newData.flagDecoder, flags);
    if (!$elm$core$Result$isOk(newFlagResult)) {
      return { tag: "ReloadPage", reason: "the flags type in \`" + moduleName + "\` changed and now the passed flags aren't correct anymore. The idea is to try to run with new flags!\\nThis is the error:\\n" + _Json_errorToString(newFlagResult.a) };
    }
    if (!_Utils_eq_elmWatchInternal(debugMetadata, newData.debugMetadata)) {
      return { tag: "ReloadPage", reason: "the message type in \`" + moduleName + '\` changed in debug mode ("debug metadata" changed).' };
    }
    init = impl.%init% || impl._impl.%init%;
    if (typeof $elm$browser$Debugger$Main$wrapInit !== "undefined") {
      init = A3($elm$browser$Debugger$Main$wrapInit, _Json_wrap(newData.debugMetadata), initPair.a.popout, init);
    }
    window.__ELM_WATCH_INIT_URL = initUrl;
    var newInitPair = init(newFlagResult.a);
    if (!_Utils_eq_elmWatchInternal(initPair, newInitPair)) {
      return { tag: "ReloadPage", reason: "\`" + moduleName + ".init\` returned something different than last time. Let's start fresh!" };
    }

    setUpdateAndSubscriptions();
    stepper(model, true /* isSync */);
    _Platform_enqueueEffects(managers, _Platform_batch(_List_Nil), subscriptions(model));
    return { tag: "Success" };
  }

  return Object.defineProperties(
    ports ? { ports: ports } : {},
    {
      __elmWatchHotReload: { value: __elmWatchHotReload },
      __elmWatchProgramType: { value: programType },
    }
  );
}

// Copy-paste of _Utils_eq but does not assume that x and y have the same type,
// and considers functions to always be equal.
function _Utils_eq_elmWatchInternal(x, y) {
  for (
    var pair, stack = [], isEqual = _Utils_eqHelp_elmWatchInternal(x, y, 0, stack);
    isEqual && (pair = stack.pop());
    isEqual = _Utils_eqHelp_elmWatchInternal(pair.a, pair.b, 0, stack)
    )
  {}

  return isEqual;
}

function _Utils_eqHelp_elmWatchInternal(x, y, depth, stack) {
  if (x === y) {
    return true;
  }

  var xType = _Utils_typeof_elmWatchInternal(x);
  var yType = _Utils_typeof_elmWatchInternal(y);

  if (xType !== yType) {
    return false;
  }

  switch (xType) {
    case "primitive":
      return false;
    case "function":
      return true;
  }

  if (x.$ !== y.$) {
    return false;
  }

  if (x.$ === 'Set_elm_builtin') {
    x = $elm$core$Set$toList(x);
    y = $elm$core$Set$toList(y);
  } else if (x.$ === 'RBNode_elm_builtin' || x.$ === 'RBEmpty_elm_builtin' || x.$ < 0) {
    x = $elm$core$Dict$toList(x);
    y = $elm$core$Dict$toList(y);
  }

  if (Object.keys(x).length !== Object.keys(y).length) {
    return false;
  }

  if (depth > 100) {
    stack.push(_Utils_Tuple2(x, y));
    return true;
  }

  for (var key in x) {
    if (!_Utils_eqHelp_elmWatchInternal(x[key], y[key], depth + 1, stack)) {
      return false;
    }
  }
  return true;
}

function _Utils_typeof_elmWatchInternal(x) {
  var type = typeof x;
  return type === "function"
    ? "function"
    : type !== "object" || type === null
    ? "primitive"
    : "objectOrArray";
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

  if (args === "__elmWatchReturnData") {
    return { virtualNode: virtualNode, programType: programType };
  }

  var node = args && args['node'] ? args['node'] : _Debug_crash(0);
  var nextNode = _VirtualDom_render(virtualNode, function() {});
  node.parentNode.replaceChild(nextNode, node);
  node = nextNode;
  var sendToApp = function() {};

  function __elmWatchHotReload(newData) {
    var patches = _VirtualDom_diff(virtualNode, newData.virtualNode);
    node = _VirtualDom_applyPatches(node, virtualNode, patches, sendToApp);
    virtualNode = newData.virtualNode;
    return { tag: "Success" };
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
  var reloadReasons = _Platform_mergeExportsElmWatch('Elm', scope['Elm'] || (scope['Elm'] = {}), exports);
  if (reloadReasons.length > 0) {
    throw new Error(["ELM_WATCH_RELOAD_NEEDED"].concat(Array.from(new Set(reloadReasons))).join("\\n\\n---\\n\\n"));
  }
}

function _Platform_mergeExportsElmWatch(moduleName, obj, exports) {
  var reloadReasons = [];
  for (var name in exports) {
    if (name === "init") {
      if ("init" in obj) {
        if ("__elmWatchApps" in obj) {
          var data = exports.init("__elmWatchReturnData");
          for (var index = 0; index < obj.__elmWatchApps.length; index++) {
            var app = obj.__elmWatchApps[index];
            if (app.__elmWatchProgramType !== data.programType) {
              reloadReasons.push("\`" + moduleName + ".main\` changed from \`" + app.__elmWatchProgramType + "\` to \`" + data.programType + "\`.");
            } else {
              var result;
              try {
                result = app.__elmWatchHotReload(data, _Platform_effectManagers, _Scheduler_enqueue, moduleName);
                switch (result.tag) {
                  case "Success":
                    break;
                  case "ReloadPage":
                    reloadReasons.push(result.reason);
                    break;
                }
              } catch (error) {
                reloadReasons.push("hot reload for \`" + moduleName + "\` failed, probably because of incompatible model changes.\\nThis is the error:\\n" + error + "\\n" + (error ? error.stack : ""));
              }
            }
          }
        } else {
          throw new Error("elm-watch: I'm trying to create \`" + moduleName + ".init\`, but it already exists and wasn't created by elm-watch. Maybe a duplicate script is getting loaded accidentally?");
        }
      } else {
        obj.__elmWatchApps = [];
        obj.init = function() {
          var app = exports.init.apply(exports, arguments);
          obj.__elmWatchApps.push(app);
          window.__ELM_WATCH_ON_INIT();
          return app;
        };
      }
    } else {
      var innerReasons = _Platform_mergeExportsElmWatch(moduleName + "." + name, obj[name] || (obj[name] = {}), exports[name]);
      reloadReasons = reloadReasons.concat(innerReasons);
    }
  }
  return reloadReasons;
}
        `.trim(),
      },
    ],
  },

  // ### _Browser_application
  // Don’t pluck things out of `impl`. Pass `impl` to `_Browser_document`. Init
  // with URL given from `_Platform_initialize` (via `window.__ELM_WATCH_INIT_URL`).
  {
    probe: /^function _Browser_application\(/m,
    replacements: [
      {
        search: /^(\s*)var onUrlChange = impl\.%onUrlChange%;/m,
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
          /^(\s*)return A3\(impl\.%init%, flags, _Browser_getUrl\(\), key\);/m,
        replace: `$1return A3(impl.%init%, flags, window.__ELM_WATCH_INIT_URL, key);`,
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
  // Also pass the type of program and the `debugMetadata` to `_Platform_initialize`.
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
        replace: `$&"Platform.worker", debugMetadata,`,
      },
    ],
  },
  {
    probe: /^var (?:_Browser_element|_Debugger_element) =/m,
    replacements: [
      {
        search:
          /^var (?:_Browser_element|_Debugger_element) =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&impl._impl ? "Browser.sandbox" : "Browser.element", debugMetadata,`,
      },
    ],
  },
  {
    probe: /^var (?:_Browser_document|_Debugger_document) =/m,
    replacements: [
      {
        search:
          /^var (?:_Browser_document|_Debugger_document) =.+\s*\{\s*return _Platform_initialize\(/gm,
        replace: `$&impl._impl ? "Browser.application" : "Browser.document", debugMetadata,`,
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
    // istanbul ignore else
    if (unknownError instanceof StrictReplaceError) {
      return unknownError.error;
    }
    // istanbul ignore next
    throw unknownError;
  }
}

function getRecordNames(code: string): Record<string, string> {
  const match = /^\s*impl\.(\w+),\s*impl\.(\w+),\s*impl\.(\w+),/m.exec(code);

  // istanbul ignore if
  if (match === null) {
    return {};
  }

  // istanbul ignore next
  const [
    ,
    init = "init_missing",
    update = "update_missing",
    subscriptions = "subscriptions_missing",
  ] = match;

  const extra = Object.fromEntries(
    Array.from(
      code.matchAll(/^\s*var (\w+) = impl\.(\w+);/gm),
      // istanbul ignore next
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
): Set<string> | undefined {
  switch (compilationMode) {
    case "debug":
    case "standard":
      return undefined;

    // If the set of accessed record field names changes in optimize mode, we cannot hot reload.
    case "optimize": {
      // istanbul ignore next
      const matches = code.match(RECORD_FIELD_REGEX) ?? [];
      return new Set(matches.filter((string) => string.startsWith(".")));
    }
  }
}

// Only one scenario counts as changed:
// We had a set of record fields (optimize mode), and then got a different set
// of record fields (also in optimize mode). Mode changes (which results in
// either side being `undefined`) does not count.
export function recordFieldsChanged(
  oldSet: Set<string> | undefined,
  newSet: Set<string> | undefined
): boolean {
  return !(
    oldSet === undefined ||
    newSet === undefined ||
    compareRecordFieldsHelper(oldSet) === compareRecordFieldsHelper(newSet)
  );
}

function compareRecordFieldsHelper(set: Set<string>): string {
  return Array.from(set).sort().join(",");
}
