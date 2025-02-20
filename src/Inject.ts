import * as Codec from "tiny-decoders";

import * as ClientCode from "./ClientCode";
import {} from "./Helpers";
import { Port } from "./Port";
import {
  BrowserUiPosition,
  CompilationMode,
  CompilationModeWithProxy,
  OutputPath,
  TargetName,
  WebSocketToken,
} from "./Types";

// This matches full functions, declared either with `function name(` or `var name =`.
// NOTE: All function names in the regex must also be mentioned in the
// `replacements` object, and vice versa!
// The regex is anchored to the beginning of lines, which should make it
// impossible to match within strings in the user’s program.
const REPLACEMENT_REGEX =
  /^(?:function (F|_Platform_initialize|_Platform_export|_Browser_application|_Scheduler_binding|_Scheduler_step)\(|var (_VirtualDom_init|\$elm\$browser\$Browser\$sandbox|_Platform_worker|_Browser_element|_Browser_document|_Debugger_element|_Debugger_document) =).*\r?\n?\{(?:.*\r?\n)*?\}\)?;?$/gm;

// Some object properties are marked with `%`, like `%prop%`. They need to be
// replaced with shorter names in `optimize` mode.
const PLACEHOLDER_REGEX = /%(\w+)%/g;

// The replacements should make the Elm JS stay strictly ES5 so that minifying
// with esbuild in ES5 works.
const REPLACEMENTS: Record<string, string> = {
  // ### _Platform_initialize (main : Program flags model msg)
  // New implementation.
  // Note: `isDebug` is needed when you have programs that do and don’t support
  // the debugger in the same output. `$elm$browser$Debugger$Main$wrapUpdate`
  // etc is going to be defined, but it should only be used in
  // `_Platform_initialize` when actually called from `_Debugger_element` or
  // `_Debugger_document`, not from `_Platform_worker`. (`Html` programs don’t
  // call `_Platform_initialize`.)
  _Platform_initialize: `
// added by elm-watch
var _elmWatchTargetName = "";

// This whole function was changed by elm-watch.
function _Platform_initialize(programType, isDebug, debugMetadata, flagDecoder, args, init, impl, stepperBuilder)
{
	if (args === "__elmWatchReturnData") {
		return { impl: impl, debugMetadata: debugMetadata, flagDecoder : flagDecoder, programType: programType, _Platform_effectManagers: _Platform_effectManagers, _Scheduler_enqueue: _Scheduler_enqueue };
	}

	var flags = _Json_wrap(args ? args['flags'] : undefined);
	var flagResult = A2(_Json_run, flagDecoder, flags);
	$elm$core$Result$isOk(flagResult) || _Debug_crash(2 /**/, _Json_errorToString(flagResult.a) /**/);
	var managers = {};
	var initUrl = programType === "Browser.application" ? _Browser_getUrl() : undefined;
	globalThis.__ELM_WATCH_INIT_URL = initUrl;
	var initPair = init(flagResult.a);
	delete globalThis.__ELM_WATCH_INIT_URL;
	var model = initPair.a;
	var stepper = stepperBuilder(sendToApp, model);
	var ports = _Platform_setupEffects(managers, sendToApp);
	var update;
	var subscriptions;

	function setUpdateAndSubscriptions() {
		update = impl.%update% || impl._impl.%update%;
		subscriptions = impl.%subscriptions% || impl._impl.%subscriptions%;
		if (isDebug) {
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

	var skippedInitCmds = globalThis.__ELM_WATCH ? globalThis.__ELM_WATCH.SHOULD_SKIP_INIT_CMDS(_elmWatchTargetName) : false;

	_Platform_enqueueEffects(managers, skippedInitCmds ? _Platform_batch(_List_Nil) : initPair.b, subscriptions(model));

	function __elmWatchHotReload(newData) {
		_Platform_enqueueEffects(managers, _Platform_batch(_List_Nil), _Platform_batch(_List_Nil));
		_Scheduler_enqueue = newData._Scheduler_enqueue;

		var reloadReasons = [];

		for (var key in newData._Platform_effectManagers) {
			var manager = newData._Platform_effectManagers[key];
			if (!(key in _Platform_effectManagers)) {
				_Platform_effectManagers[key] = manager;
				managers[key] = _Platform_instantiateManager(manager, sendToApp);
				if (manager.a) {
					reloadReasons.push({ tag: "NewPortAdded", name: key });
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
			return reloadReasons.concat({ tag: "FlagsTypeChanged", jsonErrorMessage: _Json_errorToString(newFlagResult.a) });
		}
		if (!_Utils_eq_elmWatchInternal(debugMetadata, newData.debugMetadata)) {
			return reloadReasons.concat({ tag: "MessageTypeChangedInDebugMode" });
		}
		init = impl.%init% || impl._impl.%init%;
		if (isDebug) {
			init = A3($elm$browser$Debugger$Main$wrapInit, _Json_wrap(newData.debugMetadata), initPair.a.popout, init);
		}
		globalThis.__ELM_WATCH_INIT_URL = initUrl;
		var newInitPair = init(newFlagResult.a);
		delete globalThis.__ELM_WATCH_INIT_URL;
		if (!_Utils_eq_elmWatchInternal(initPair, newInitPair)) {
			return reloadReasons.concat({ tag: "InitReturnValueChanged" });
		}

		setUpdateAndSubscriptions();
		stepper(model, true /* isSync */);
		_Platform_enqueueEffects(managers, skippedInitCmds ? newInitPair.b : _Platform_batch(_List_Nil), subscriptions(model));
		skippedInitCmds = false;
		return reloadReasons;
	}

	function __elmWatchRunInitCmds() {
		if (skippedInitCmds) {
			_Platform_enqueueEffects(managers, initPair.b, subscriptions(model));
			skippedInitCmds = false;
		}
	}

	return Object.defineProperties(
		ports ? { ports: ports } : {},
		{
			__elmWatchHotReload: { value: __elmWatchHotReload },
			__elmWatchRunInitCmds: { value: __elmWatchRunInitCmds },
			__elmWatchProgramType: { value: programType },
		}
	);
}

// This whole function was added by elm-watch.
// Copy-paste of _Utils_eq but does not assume that x and y have the same type,
// and considers functions to always be equal.
function _Utils_eq_elmWatchInternal(x, y)
{
	for (
		var pair, stack = [], isEqual = _Utils_eqHelp_elmWatchInternal(x, y, 0, stack);
		isEqual && (pair = stack.pop());
		isEqual = _Utils_eqHelp_elmWatchInternal(pair.a, pair.b, 0, stack)
		)
	{}

	return isEqual;
}

// This whole function was added by elm-watch.
function _Utils_eqHelp_elmWatchInternal(x, y, depth, stack)
{
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

// This whole function was added by elm-watch.
function _Utils_typeof_elmWatchInternal(x)
{
	var type = typeof x;
	return type === "function"
		? "function"
		: type !== "object" || type === null
		? "primitive"
		: "objectOrArray";
}
				`.trim(),

  // Make sure these are always defined for easier code in `_Platform_initialize`.
  // We don’t actually do anything with the `F` function – it’s just a way to get
  // these definitions near the top of the file.
  F: `
var _Platform_effectManagers = {}, _Scheduler_enqueue; // added by elm-watch

function F(arity, fun, wrapper) {
  wrapper.a = arity;
  wrapper.f = fun;
  return wrapper;
}
  `.trim(),

  // ### _VirtualDom_init (main : Html msg)
  // New implementation.
  _VirtualDom_init: `
// This whole function was changed by elm-watch.
var _VirtualDom_init = F4(function(virtualNode, flagDecoder, debugMetadata, args)
{
	var programType = "Html";

	if (args === "__elmWatchReturnData") {
		return { virtualNode: virtualNode, programType: programType, _Platform_effectManagers: _Platform_effectManagers, _Scheduler_enqueue: _Scheduler_enqueue };
	}

	/**_UNUSED/ // always UNUSED with elm-watch
	var node = args['node'];
	//*/
	/**/
	var node = args && args['node'] ? args['node'] : _Debug_crash(0);
	//*/

	var nextNode = _VirtualDom_render(virtualNode, function() {});
	node.parentNode.replaceChild(nextNode, node);
	node = nextNode;
	var sendToApp = function() {};

	function __elmWatchHotReload(newData) {
		var patches = _VirtualDom_diff(virtualNode, newData.virtualNode);
		node = _VirtualDom_applyPatches(node, virtualNode, patches, sendToApp);
		virtualNode = newData.virtualNode;
		return [];
	}

	return Object.defineProperties(
		{},
		{
			__elmWatchHotReload: { value: __elmWatchHotReload },
			__elmWatchRunInitCmds: { value: Function.prototype },
			__elmWatchProgramType: { value: programType },
		}
	);
});
				`.trim(),

  // ### _Platform_export
  // Allow registering the exports, and skipping the usual merging of `window.Elm` (for hot reloading).
  _Platform_export: `
function _Platform_export(exports)
{
	// added by elm-watch
	if (globalThis.__ELM_WATCH) {
		if (globalThis.__ELM_WATCH.IS_REGISTERING) {
			globalThis.__ELM_WATCH.REGISTER(_elmWatchTargetName, exports);
		} else {
			globalThis.__ELM_WATCH.HOT_RELOAD(_elmWatchTargetName, exports);
			return;
		}
	}

	scope['Elm']
		? _Platform_mergeExportsDebug('Elm', scope['Elm'], exports) // Always calls the debug version with elm-watch (the only difference is an error message).
		: scope['Elm'] = exports;
}
				`.trim(),

  // ### _Browser_application
  // Don’t pluck things out of `impl`. Pass `impl` to `_Browser_document`. Init
  // with URL given from `_Platform_initialize` (via `globalThis.__ELM_WATCH_INIT_URL`).
  _Browser_application: `
// This function was slightly modified by elm-watch.
function _Browser_application(impl)
{
	// var onUrlChange = impl.onUrlChange; // commented out by elm-watch
	// var onUrlRequest = impl.onUrlRequest; // commented out by elm-watch
	// var key = function() { key.a(onUrlChange(_Browser_getUrl())); }; // commented out by elm-watch
	var key = function() { key.a(impl.%onUrlChange%(_Browser_getUrl())); }; // added by elm-watch

	return _Browser_document({
		%setup%: function(sendToApp)
		{
			key.a = sendToApp;
			_Browser_window.addEventListener('popstate', key);
			_Browser_window.navigator.userAgent.indexOf('Trident') < 0 || _Browser_window.addEventListener('hashchange', key);

			return F2(function(domNode, event)
			{
				if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.button < 1 && !domNode.target && !domNode.hasAttribute('download'))
				{
					event.preventDefault();
					var href = domNode.href;
					var curr = _Browser_getUrl();
					var next = $elm$url$Url$fromString(href).a;
					sendToApp(impl.%onUrlRequest%(
						(next
							&& curr.%protocol% === next.%protocol%
							&& curr.%host% === next.%host%
							&& curr.%port_%.a === next.%port_%.a
						)
							? $elm$browser$Browser$Internal(next)
							: $elm$browser$Browser$External(href)
					));
				}
			});
		},
		%init%: function(flags)
		{
			// return A3(impl.init, flags, _Browser_getUrl(), key); // commented out by elm-watch
			return A3(impl.%init%, flags, globalThis.__ELM_WATCH_INIT_URL, key); // added by elm-watch
		},
		// view: impl.view, // commented out by elm-watch
		// update: impl.update, // commented out by elm-watch
		// subscriptions: impl.subscriptions // commented out by elm-watch
		%view%: function(model) { return impl.%view%(model); }, // added by elm-watch
		_impl: impl // added by elm-watch
	});
}
  `.trim(),

  // ### $elm$browser$Browser$sandbox
  // Don’t pluck `view` from `impl`. Pass `impl` to `_Browser_element`.
  $elm$browser$Browser$sandbox: `
// This function was slightly modified by elm-watch.
var $elm$browser$Browser$sandbox = function (impl) {
	return _Browser_element(
		{
			%init%: function (_v0) {
				return _Utils_Tuple2(impl.%init%, $elm$core$Platform$Cmd$none);
			},
			%subscriptions%: function (_v1) {
				return $elm$core$Platform$Sub$none;
			},
			%update%: F2(
				function (msg, model) {
					return _Utils_Tuple2(
						A2(impl.%update%, msg, model),
						$elm$core$Platform$Cmd$none);
				}),
			// view: impl.view // commented out by elm-watch
			%view%: function(model) { return impl.%view%(model); }, // added by elm-watch
			_impl: impl // added by elm-watch
		});
};
  `.trim(),

  // ### _Platform_worker, _Browser_element, _Browser_document, _Debugger_element, _Debugger_document
  // Update call to `_Platform_initialize` to match our implementation.
  // `_Browser_application` calls `_Browser_document`/`_Debugger_document`.
  // `$elm$browser$Browser$sandbox` calls `_Browser_element`/`_Debugger_element`.
  // In those cases we need `impl._impl`.
  // Don’t pluck `view` from `impl`.
  // Also pass the type of program, `isDebug` and the `debugMetadata` to `_Platform_initialize`.
  _Platform_worker: `
// This function was slightly modified by elm-watch.
var _Platform_worker = F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		"Platform.worker", // added by elm-watch
		false, // isDebug, added by elm-watch
		debugMetadata, // added by elm-watch
		flagDecoder,
		args,
		impl.%init%,
		// impl.update, // commented out by elm-watch
		// impl.subscriptions, // commented out by elm-watch
		impl, // added by elm-watch
		function() { return function() {} }
	);
});
  `.trim(),

  _Browser_element: `
// This function was slightly modified by elm-watch.
var _Browser_element = _Debugger_element || F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		impl._impl ? "Browser.sandbox" : "Browser.element", // added by elm-watch
		false, // isDebug, added by elm-watch
		debugMetadata, // added by elm-watch
		flagDecoder,
		args,
		impl.%init%,
		// impl.update, // commented out by elm-watch
		// impl.subscriptions, // commented out by elm-watch
		impl, // added by elm-watch
		function(sendToApp, initialModel) {
			// var view = impl.view; // commented out by elm-watch
			/**_UNUSED/ // always UNUSED with elm-watch
			var domNode = args['node'];
			//*/
			/**/
			var domNode = args && args['node'] ? args['node'] : _Debug_crash(0);
			//*/
			var currNode = _VirtualDom_virtualize(domNode);

			return _Browser_makeAnimator(initialModel, function(model)
			{
				// var nextNode = view(model); // commented out by elm-watch
				var nextNode = impl.%view%(model); // added by elm-watch
				var patches = _VirtualDom_diff(currNode, nextNode);
				domNode = _VirtualDom_applyPatches(domNode, currNode, patches, sendToApp);
				currNode = nextNode;
			});
		}
	);
});
  `.trim(),

  _Browser_document: `
// This function was slightly modified by elm-watch.
var _Browser_document = _Debugger_document || F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		impl._impl ? "Browser.application" : "Browser.document", // added by elm-watch
		false, // isDebug, added by elm-watch
		debugMetadata, // added by elm-watch
		flagDecoder,
		args,
		impl.%init%,
		// impl.update, // commented out by elm-watch
		// impl.subscriptions, // commented out by elm-watch
		impl, // added by elm-watch
		function(sendToApp, initialModel) {
			var divertHrefToApp = impl.%setup% && impl.%setup%(sendToApp)
			// var view = impl.view; // commented out by elm-watch
			var title = _VirtualDom_doc.title;
			var bodyNode = _VirtualDom_doc.body;
			_VirtualDom_divertHrefToApp = divertHrefToApp; // added by elm-watch
			var currNode = _VirtualDom_virtualize(bodyNode);
			_VirtualDom_divertHrefToApp = 0; // added by elm-watch
			return _Browser_makeAnimator(initialModel, function(model)
			{
				_VirtualDom_divertHrefToApp = divertHrefToApp;
				// var doc = view(model); // commented out by elm-watch
				var doc = impl.%view%(model); // added by elm-watch
				var nextNode = _VirtualDom_node('body')(_List_Nil)(doc.%body%);
				var patches = _VirtualDom_diff(currNode, nextNode);
				bodyNode = _VirtualDom_applyPatches(bodyNode, currNode, patches, sendToApp);
				currNode = nextNode;
				_VirtualDom_divertHrefToApp = 0;
				(title !== doc.%title%) && (_VirtualDom_doc.title = title = doc.%title%);
			});
		}
	);
});
  `.trim(),

  // Note: Debugger code does not need to worry about optimize mode shortened record fields.
  _Debugger_element: `
// This function was slightly modified by elm-watch.
var _Debugger_element = F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		impl._impl ? "Browser.sandbox" : "Browser.element", // added by elm-watch
		true, // isDebug, added by elm-watch
		debugMetadata, // added by elm-watch
		flagDecoder,
		args,
		A3($elm$browser$Debugger$Main$wrapInit, _Json_wrap(debugMetadata), _Debugger_popout(), impl.init),
		// $elm$browser$Debugger$Main$wrapUpdate(impl.update), // commented out by elm-watch
		// $elm$browser$Debugger$Main$wrapSubs(impl.subscriptions), // commented out by elm-watch
		impl, // added by elm-watch
		function(sendToApp, initialModel)
		{
			// var view = impl.view; // commented out by elm-watch
			var title = _VirtualDom_doc.title;
			var domNode = args && args['node'] ? args['node'] : _Debug_crash(0);
			var currNode = _VirtualDom_virtualize(domNode);
			var currBlocker = $elm$browser$Debugger$Main$toBlockerType(initialModel);
			var currPopout;

			var cornerNode = _VirtualDom_doc.createElement('div');
			domNode.parentNode.insertBefore(cornerNode, domNode.nextSibling);
			var cornerCurr = _VirtualDom_virtualize(cornerNode);

			initialModel.popout.a = sendToApp;

			return _Browser_makeAnimator(initialModel, function(model)
			{
				// var nextNode = A2(_VirtualDom_map, $elm$browser$Debugger$Main$UserMsg, view($elm$browser$Debugger$Main$getUserModel(model))); // commented out by elm-watch
				var nextNode = A2(_VirtualDom_map, $elm$browser$Debugger$Main$UserMsg, impl.view($elm$browser$Debugger$Main$getUserModel(model))); // added by elm-watch
				var patches = _VirtualDom_diff(currNode, nextNode);
				domNode = _VirtualDom_applyPatches(domNode, currNode, patches, sendToApp);
				currNode = nextNode;

				// update blocker

				var nextBlocker = $elm$browser$Debugger$Main$toBlockerType(model);
				_Debugger_updateBlocker(currBlocker, nextBlocker);
				currBlocker = nextBlocker;

				// view corner

				var cornerNext = $elm$browser$Debugger$Main$cornerView(model);
				var cornerPatches = _VirtualDom_diff(cornerCurr, cornerNext);
				cornerNode = _VirtualDom_applyPatches(cornerNode, cornerCurr, cornerPatches, sendToApp);
				cornerCurr = cornerNext;

				if (!model.popout.b)
				{
					currPopout = undefined;
					return;
				}

				// view popout

				_VirtualDom_doc = model.popout.b; // SWITCH TO POPOUT DOC
				// currPopout || (currPopout = _VirtualDom_virtualize(model.popout.b)); // commented out by elm-watch
				currPopout || (currPopout = _VirtualDom_virtualize(model.popout.b.body)); // added by elm-watch
				var nextPopout = $elm$browser$Debugger$Main$popoutView(model);
				var popoutPatches = _VirtualDom_diff(currPopout, nextPopout);
				_VirtualDom_applyPatches(model.popout.b.body, currPopout, popoutPatches, sendToApp);
				currPopout = nextPopout;
				_VirtualDom_doc = document; // SWITCH BACK TO NORMAL DOC
			});
		}
	);
});
  `.trim(),

  _Debugger_document: `
// This function was slightly modified by elm-watch.
var _Debugger_document = F4(function(impl, flagDecoder, debugMetadata, args)
{
	return _Platform_initialize(
		impl._impl ? "Browser.application" : "Browser.document", // added by elm-watch
		true, // isDebug, added by elm-watch
		debugMetadata, // added by elm-watch
		flagDecoder,
		args,
		A3($elm$browser$Debugger$Main$wrapInit, _Json_wrap(debugMetadata), _Debugger_popout(), impl.init),
		// $elm$browser$Debugger$Main$wrapUpdate(impl.update), // commented out by elm-watch
		// $elm$browser$Debugger$Main$wrapSubs(impl.subscriptions), // commented out by elm-watch
		impl, // added by elm-watch
		function(sendToApp, initialModel)
		{
			var divertHrefToApp = impl.setup && impl.setup(function(x) { return sendToApp($elm$browser$Debugger$Main$UserMsg(x)); });
			// var view = impl.view; // commented out by elm-watch
			var title = _VirtualDom_doc.title;
			var bodyNode = _VirtualDom_doc.body;
			_VirtualDom_divertHrefToApp = divertHrefToApp; // added by elm-watch
			var currNode = _VirtualDom_virtualize(bodyNode);
			_VirtualDom_divertHrefToApp = 0; // added by elm-watch
			var currBlocker = $elm$browser$Debugger$Main$toBlockerType(initialModel);
			var currPopout;

			initialModel.popout.a = sendToApp;

			return _Browser_makeAnimator(initialModel, function(model)
			{
				_VirtualDom_divertHrefToApp = divertHrefToApp;
				// var doc = view($elm$browser$Debugger$Main$getUserModel(model)); // commented out by elm-watch
				var doc = impl.view($elm$browser$Debugger$Main$getUserModel(model)); // added by elm-watch
				var nextNode = _VirtualDom_node('body')(_List_Nil)(
					_Utils_ap(
						A2($elm$core$List$map, _VirtualDom_map($elm$browser$Debugger$Main$UserMsg), doc.body),
						_List_Cons($elm$browser$Debugger$Main$cornerView(model), _List_Nil)
					)
				);
				var patches = _VirtualDom_diff(currNode, nextNode);
				bodyNode = _VirtualDom_applyPatches(bodyNode, currNode, patches, sendToApp);
				currNode = nextNode;
				_VirtualDom_divertHrefToApp = 0;
				(title !== doc.title) && (_VirtualDom_doc.title = title = doc.title);

				// update blocker

				var nextBlocker = $elm$browser$Debugger$Main$toBlockerType(model);
				_Debugger_updateBlocker(currBlocker, nextBlocker);
				currBlocker = nextBlocker;

				// view popout

				if (!model.popout.b) { currPopout = undefined; return; }

				_VirtualDom_doc = model.popout.b; // SWITCH TO POPOUT DOC
				// currPopout || (currPopout = _VirtualDom_virtualize(model.popout.b)); // commented out by elm-watch
				currPopout || (currPopout = _VirtualDom_virtualize(model.popout.b.body)); // added by elm-watch
				var nextPopout = $elm$browser$Debugger$Main$popoutView(model);
				var popoutPatches = _VirtualDom_diff(currPopout, nextPopout);
				_VirtualDom_applyPatches(model.popout.b.body, currPopout, popoutPatches, sendToApp);
				currPopout = nextPopout;
				_VirtualDom_doc = document; // SWITCH BACK TO NORMAL DOC
			});
		}
	);
});
  `.trim(),

  // ### _Scheduler_binding, _Scheduler_step
  // This is needed because Elm mutates `Task`s in `_Scheduler_step`:
  //
  //     proc.__root.__kill = proc.__root.__callback(function(newRoot) {
  //
  // Some tasks are cancelable so `.__kill` is set to a function. Some are not,
  // and then `.__kill` seems to be set to `undefined`. But the initial value is
  // `null`! Later, there's just a truthiness check on `.__kill` so both `null` and
  // `undefined` works. However, this means that the “did `init` return the same
  // thing as last time?” check fails:
  //
  // - Either because of `null` vs `undefined`.
  // - Or because of `null` vs `function`.
  //
  // To solve this, make sure that `.__kill` (called `.c` in what we have to
  // work with below) is _always_ set to a function – a dummy one for
  // non-cancelable tasks (`Function.prototype` is a no-op function).
  // `_Utils_eq_elmWatchInternal` considers all functions to be equal.
  _Scheduler_binding: `
// This function was slightly modified by elm-watch.
function _Scheduler_binding(callback)
{
	return {
		$: 2,
		b: callback,
		// c: null // commented out by elm-watch
		c: Function.prototype // added by elm-watch
	};
}
  `.trim(),

  _Scheduler_step: `
function _Scheduler_step(proc)
{
	while (proc.f)
	{
		var rootTag = proc.f.$;
		if (rootTag === 0 || rootTag === 1)
		{
			while (proc.g && proc.g.$ !== rootTag)
			{
				proc.g = proc.g.i;
			}
			if (!proc.g)
			{
				return;
			}
			proc.f = proc.g.b(proc.f.a);
			proc.g = proc.g.i;
		}
		else if (rootTag === 2)
		{
			proc.f.c = proc.f.b(function(newRoot) {
				proc.f = newRoot;
				_Scheduler_enqueue(proc);
			// }); // commented out by elm-watch
			}) || Function.prototype; // added by elm-watch
			return;
		}
		else if (rootTag === 5)
		{
			if (proc.h.length === 0)
			{
				return;
			}
			proc.f = proc.f.b(proc.h.shift());
		}
		else // if (rootTag === 3 || rootTag === 4)
		{
			proc.g = {
				$: rootTag === 3 ? 0 : 1,
				b: proc.f.b,
				i: proc.g
			};
			proc.f = proc.f.d;
		}
	}
}
  `.trim(),
};

const REPLACEMENTS_WITHOUT_PLACEHOLDERS = updateReplacements({}, REPLACEMENTS);

export function inject(
  compilationMode: CompilationMode,
  code: string,
  targetName?: TargetName,
): string {
  const replacements = getReplacements(compilationMode, code);

  return (
    code
      .replace(
        REPLACEMENT_REGEX,
        (match, name1: string, name: string = name1) =>
          /* v8 ignore start */
          replacements[name] ??
          `${match} /* elm-watch ERROR: No replacement for function '${name}' was found! */`,
        /* v8 ignore stop */
      )
      // Doing this as a separate replacement is faster than trying to add it to `REPLACEMENT_REGEX`.
      .replace(
        /^var _elmWatchTargetName = "";$/m,
        /* v8 ignore next */
        `var _elmWatchTargetName = ${Codec.JSON.stringify(Codec.string, targetName ?? "")};`,
      )
  );
}

function getReplacements(
  compilationMode: CompilationMode,
  code: string,
): Record<string, string> {
  switch (compilationMode) {
    case "debug":
    case "standard":
      return REPLACEMENTS_WITHOUT_PLACEHOLDERS;

    case "optimize":
      return updateReplacements(getOptimizeModeRecordNames(code), REPLACEMENTS);
  }
}

// `.init` might be called `.G` in optimize mode. This figures out the shortened
// names needed for hot reloading.
function getOptimizeModeRecordNames(code: string): Record<string, string> {
  const match1 =
    /^\s*impl\.([\w$]+),\s*impl\.([\w$]+),\s*impl\.([\w$]+),/m.exec(code);
  const match2 = /^\s*var divertHrefToApp = impl\.([\w$]+)/m.exec(code);
  const match3 =
    /^\s*var nextNode = _VirtualDom_node\('body'\)\(_List_Nil\)\(doc\.([\w$]+)\);/m.exec(
      code,
    );
  const match4 = /^\s*\(title !== doc\.([\w$]+)\)/m.exec(code);
  const match5 =
    /^\s*&& curr\.([\w$]+) .*\s*&& curr\.([\w$]+) .*\s*&& curr\.([\w$]+)\..*/m.exec(
      code,
    );

  /* v8 ignore start */
  const [
    ,
    init = "init_missing",
    update = "update_missing",
    subscriptions = "subscriptions_missing",
  ] = match1 ?? [];
  /* v8 ignore stop */

  /* v8 ignore next */
  const [, setup = "setup_missing"] = match2 ?? [];

  /* v8 ignore next */
  const [, body = "body_missing"] = match3 ?? [];

  /* v8 ignore next */
  const [, title = "title_missing"] = match4 ?? [];

  /* v8 ignore next */
  const [
    ,
    protocol = "protocol_missing",
    host = "host_missing",
    port_ = "port__missing",
  ] = match5 ?? [];

  const extra = Object.fromEntries(
    Array.from(
      code.matchAll(/^\s*var ([\w$]+) = impl\.([\w$]+);/gm),
      /* v8 ignore next */
      ([, from = "from_missing", to = "to_missing"]) => [from, to],
    ),
  );

  return {
    ...extra,
    init,
    update,
    subscriptions,
    setup,
    body,
    title,
    protocol,
    host,
    port_,
  };
}

function updateReplacements(
  optimizeModeRecordNames: Record<string, string>,
  replacements: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(replacements).map(([key, value]) => [
      key,
      updateString(optimizeModeRecordNames, value),
    ]),
  );
}

function updateString(
  optimizeModeRecordNames: Record<string, string>,
  string: string,
): string {
  return string.replace(
    PLACEHOLDER_REGEX,
    (_, name: string) => optimizeModeRecordNames[name] ?? name,
  );
}

export function proxyFile(
  outputPath: OutputPath,
  elmCompiledTimestamp: number,
  browserUiPosition: BrowserUiPosition,
  webSocketPort: Port,
  webSocketToken: WebSocketToken,
  debug: boolean,
): string {
  const clientCodeString = clientCode(
    outputPath,
    elmCompiledTimestamp,
    "proxy",
    browserUiPosition,
    webSocketPort,
    webSocketToken,
    debug,
  );
  const proxyCodeString = ClientCode.proxy
    .replace(
      /"%TARGET_NAME%"/g,
      Codec.JSON.stringify(Codec.string, outputPath.targetName),
    )
    .replace(/__this__ = window/g, "__this__ = this");
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
  return `${clientCodeString}\n${proxyCodeString}\n0 && await/2//2; const Elm = globalThis.Elm; export { Elm as default, Elm as Elm }`;
}

export function clientCode(
  outputPath: OutputPath,
  elmCompiledTimestamp: number,
  compilationMode: CompilationModeWithProxy,
  browserUiPosition: BrowserUiPosition,
  webSocketPort: Port,
  webSocketToken: WebSocketToken,
  debug: boolean,
): string {
  const replacements: Record<string, string> = {
    TARGET_NAME: outputPath.targetName,
    INITIAL_ELM_COMPILED_TIMESTAMP: elmCompiledTimestamp.toString(),
    ORIGINAL_COMPILATION_MODE: compilationMode,
    ORIGINAL_BROWSER_UI_POSITION: browserUiPosition,
    WEBSOCKET_PORT: webSocketPort.toString(),
    WEBSOCKET_TOKEN: webSocketToken,
    DEBUG: debug.toString(),
  };
  return (
    versionedIdentifier(outputPath.targetName, webSocketPort, webSocketToken) +
    ClientCode.client.replace(
      new RegExp(`"%(${Object.keys(replacements).join("|")})%"`, "g"),
      (_, name: string) =>
        /* v8 ignore next */
        Codec.JSON.stringify(Codec.string, replacements[name] ?? name),
    )
  );
}

// When only typechecking, don’t write a proxy file if:
// - The output exists.
// - And it was created by `elm-watch hot`. (`elm-watch make` output does not contain WebSocket stuff).
// - And it was created by the same version of `elm-watch`. (Older versions could have bugs.)
// - And it has the same target name. (It might have changed, and needs to match.)
// - And it used the same WebSocket port. (Otherwise it will never connect to us.)
// - And it used the same WebSocket token. (Otherwise we will reject the connection.)
export function versionedIdentifier(
  targetName: TargetName,
  webSocketPort: Port,
  webSocketToken: WebSocketToken,
): string {
  return `// elm-watch hot ${Codec.JSON.stringify(Codec.unknown, {
    version: "%VERSION%",
    targetName,
    webSocketPort,
    webSocketToken,
  })}\n`;
}

// Matches string literals, multiline comments, singleline comments and `.foo`.
// We’re only interested in `.foo` – but only outside strings and comments.
// Copied from: https://github.com/lydell/js-tokens/blob/15439aa6c3a66afa852c3549f8f57076935ead1f/index.coffee
const RECORD_FIELD_REGEX =
  /(['"])(?:(?!\1)[^\\\n\r]|\\(?:\r\n|[^]))*(\1)?|\/\*(?:[^*]|\*(?!\/))*(\*\/)?|\/\/.*|\.[\w$]{1,4}\b/g;

export function getRecordFields(
  compilationMode: CompilationMode,
  code: string,
): Set<string> | undefined {
  switch (compilationMode) {
    case "debug":
    case "standard":
      return undefined;

    // If the set of accessed record field names changes in optimize mode, we cannot hot reload.
    case "optimize": {
      /* v8 ignore next */
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
  newSet: Set<string> | undefined,
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
