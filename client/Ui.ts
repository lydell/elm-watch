import * as Codec from "tiny-decoders";

import {
  EDITOR_PRESETS,
  type EditorPreset,
  editorUrl,
  findPreset,
} from "../src/Editor.ts";
import {
  type ErrorGroup,
  getErrorNumber,
  getOpenEditorLocation,
  getSelectedError,
  makeErrorGroup,
  navigate,
  type NavigationKey,
  reconcile,
  type Selection,
} from "../src/ErrorSelection.ts";
import { formatTime } from "../src/Helpers.ts";
import type {
  AbsolutePath,
  CompilationMode,
  CompilationModeWithProxy,
} from "../src/Types.ts";
import type { ErrorLocation, OpenEditorEnv } from "./WebSocketMessages.ts";

export type UiMsg =
  | {
      tag: "ChangedCompilationMode";
      compilationMode: CompilationMode;
      sendKey: SendKey;
    }
  | {
      tag: "ChoseEditor";
      // A preset ID or URL template (see `Editor.ts`). `null` forgets the
      // choice.
      editor: string | null;
      sendKey: SendKey;
    }
  | {
      tag: "PressedOpenEditor";
      file: AbsolutePath;
      line: number;
      column: number;
      sendKey: SendKey;
    }
  | {
      tag: "PressedReconnectNow";
    };

// See `OpenEditorSetupChanged`.
export type OpenEditorSetup = {
  preset: string | null;
  env: OpenEditorEnv | null;
};

export type OverlayError = {
  title: string;
  location: ErrorLocation | undefined;
  htmlContent: string;
  // Only set if there are long code excerpts to collapse.
  htmlContentCollapsed: string | undefined;
  foregroundColor: string;
  backgroundColor: string;
};

// Errors from outside elm-watch (such as from esbuild), from the `errors`
// option. They are the same for all targets.
export type ExternalErrorsSource = {
  source: string;
  errors: Map<string, OverlayError>;
};

export type Status =
  | {
      tag: "Busy";
      date: Date;
      // The errors from the previous status, if any.
      errors: Map<string, OverlayError> | undefined;
    }
  | {
      tag: "CompileError";
      date: Date;
      sendKey: SendKey;
      errors: Map<string, OverlayError>;
    }
  | {
      tag: "Connecting";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "TargetError";
      date: Date;
      error: string;
    }
  | {
      tag: "EvalError";
      date: Date;
    }
  | {
      tag: "FileProtocol";
      date: Date;
    }
  | {
      tag: "Idle";
      date: Date;
      sendKey: SendKey;
    }
  | {
      tag: "SleepingBeforeReconnect";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "UnexpectedError";
      date: Date;
      message: string;
    }
  | {
      tag: "WaitingForReload";
      date: Date;
      reasons: Array<string>;
    };

export type SendKey = typeof SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

export const SEND_KEY_DO_NOT_USE_ALL_THE_TIME: unique symbol = Symbol(
  "This value is supposed to only be obtained via `Status`.",
);

// There is only one browser UI per page, even when there are several targets
// (scripts) on the page. Each target runs its own copy of the client code, and
// the first one creates the UI and stores it on `window.__ELM_WATCH`. The other
// targets register with that UI. Targets only report their state to the UI,
// and the UI is the only one touching its DOM elements. This means that the
// code in this module must not use anything specific to the target it happens
// to be bundled with.
//
// The targets on a page might come from different versions of elm-watch. Bump
// the version in `__ELM_WATCH.UI_V1` (in client.ts) whenever `Ui` or anything
// it uses changes (such as `TargetSnapshot`). Targets with a different UI
// version get a UI of their own.

// Documented, for hiding the UI with CSS, so it does not change with the UI
// version. Several UIs (from different versions) get the same ID, which is
// fine since nothing looks the container up by ID. elm-watch 1.x uses
// `elm-watch`, and reuses an existing element with that ID.
const CONTAINER_ID = "elm-watch2";

export type Ui = {
  register: (targetName: string) => UiTarget;
};

export type UiTarget = {
  subscribe: (callbacks: UiTargetCallbacks) => () => void;
  render: (snapshot: TargetSnapshot) => void;
  flash: (flashType: FlashType) => void;
  // The error overlay shows the errors of all targets. It is opened when a
  // target gets new errors (`open: true`), and stays closed after the user
  // closes it, until the next time.
  setErrors: (
    errors: Map<string, OverlayError>,
    sendKey: SendKey | undefined,
    options: { open: boolean },
  ) => void;
  // Every target gets the same external errors from the server. New errors
  // open the error overlay, just like for `setErrors`.
  setExternalErrors: (
    sources: Array<ExternalErrorsSource>,
    sendKey: SendKey | undefined,
  ) => void;
  // For statuses that need the user’s attention.
  openPanel: () => void;
  // Shown in the error overlay, where the error location was clicked, until
  // the next key press.
  showOpenEditorError: (message: string) => void;
  unregister: () => void;
};

type UiTargetCallbacks = {
  onUiMsg: (msg: UiMsg) => void;
};

export type TargetSnapshot = {
  status: Status;
  compilationMode: CompilationModeWithProxy;
  elmCompiledTimestamp: number;
  elmCompiledTimestampBeforeReload: number | undefined;
  info: Info;
  // For actions that work in more statuses than the ones with a `sendKey`.
  sendKey: SendKey | undefined;
  openEditor: OpenEditorSetup | undefined;
};

type OverlayErrorsEntry = {
  errors: Map<string, OverlayError>;
  sendKey: SendKey | undefined;
  dispatch: (msg: UiMsg) => void;
};

type EditorChooser = {
  // The error location to open once an editor has been chosen.
  location: LocationToOpen | undefined;
  // Whether “Other” has been chosen, showing how to set up other editors.
  showOther: boolean;
};

type EditorChooserProps = EditorChooser & {
  current: EditorPreset | undefined;
  envSet: boolean;
  // `null` goes back to using `ELM_WATCH_OPEN_EDITOR`.
  onChoose: (editor: string | null) => void;
  onShowOther: () => void;
};

type OverlayEditor = {
  // The editor chosen in the browser or the terminal, if any. Takes precedence
  // over `ELM_WATCH_OPEN_EDITOR`.
  current: EditorPreset | undefined;
  // Whether `ELM_WATCH_OPEN_EDITOR` is set.
  envSet: boolean;
  chooser: EditorChooserProps | undefined;
};

type TargetEntry = {
  targetName: string;
  callbacks: UiTargetCallbacks | undefined;
  snapshot: TargetSnapshot | undefined;
};

// The emoji snaps to the left or right edge of the window. `y` goes from 0
// (top) to 1 (bottom). The position is stored per origin in localStorage, so
// that it is shared by all pages and targets.
type UiPosition = Codec.Infer<typeof UiPosition>;
const UiPosition = Codec.fields({
  side: Codec.primitiveUnion(["left", "right"]),
  y: Codec.number,
});

const UI_POSITION_STORAGE_KEY = "elm-watch:ui-position";

// The Elm debugger’s button is in the bottom-right corner.
const DEFAULT_UI_POSITION: UiPosition = { side: "left", y: 1 };

// How far the pointer needs to move before a press on the emoji turns into
// dragging it.
const DRAG_THRESHOLD = 5;

// The emoji glides to its new position after being moved, overshooting a
// little at the end. The max overshoot matches `--gap` (the distance to the
// edges of the window).
const MOVE_ANIMATION_DURATION = 250;
const MOVE_ANIMATION_MAX_OVERSHOOT = 4;

// Shift + up/down moves the emoji this much.
const KEYBOARD_STEP = 0.25;

export function createUi(): Ui {
  // The only element in the page’s DOM. Everything else is in its shadow root.
  const container = h(HTMLDivElement, { id: CONTAINER_ID });
  // Note: If we add any more styling to this element, Chrome and Safari expand all the styles
  // in the element inspector, which takes several lines and is pretty distracting.
  container.style.all = "initial";
  // elm-watch’s UI is in English, even if the page is in another language.
  // This matters for screen readers, for example. Also, don’t let page
  // translators (like the ones built into Safari and Firefox) translate the UI:
  // When testing a page with a translator on, you don’t want elm-watch’s UI
  // (including error messages and code) to be translated. (These are also set
  // on the elements in the shadow root, since browsers don’t agree on whether
  // they are inherited into it.)
  container.lang = "en";
  container.setAttribute("translate", "no");

  // The dialog is opened as a modal while the error overlay is shown (see
  // `updateErrorOverlayVisibility`). It contains all of elm-watch’s UI, not
  // just the overlay: A modal dialog makes everything outside it inert, and the
  // emoji and the panel (which can hide the errors, for example) need to keep
  // working while the overlay is shown.
  const dialog = h(HTMLDialogElement, { className: CLASS.dialog });

  // This element covers the whole window, but lets clicks through to the page
  // (except on our own elements). It is put in the top layer as a popover (see
  // `moveToTopLayer`). (In Safari, when making a `<dialog>` element into a
  // popover, it always covers the entire page, making it impossible to click
  // things, so the dialog can’t be the popover.) Popovers and modal dialogs get
  // a `::backdrop`. Being in the shadow root, the page’s `::backdrop` styles
  // (for its own dialogs) can’t reach them.
  const topLayer = h(HTMLDivElement, { className: CLASS.topLayer });
  // This enables popover mode, allowing `.showPopover()` to be called later:
  topLayer.popover = "manual";

  const closeErrorOverlay = (): void => {
    setErrorOverlayOpen(false);
  };

  // The overlay itself is focused when it opens (rather than the first button),
  // so that Enter and Space work as key hints, and Page Up/Down scroll.
  const overlay = h(HTMLDivElement, {
    className: CLASS.overlay,
    attrs: { "data-test-id": "Overlay", tabindex: "-1" },
    hidden: true,
  });

  // The overlay content is re-created on every render, and screen readers
  // usually don’t announce newly inserted live regions. So this one stays put,
  // and says which error is shown when it changes.
  const overlayAnnouncement = h(HTMLParagraphElement, {
    className: CLASS.visuallyHidden,
    attrs: { "aria-live": "polite" },
    hidden: true,
  });

  // Re-added to the overlay on every render, as its first child.
  const overlayCloseButton = h(
    HTMLButtonElement,
    {
      className: CLASS.overlayCloseButton,
      attrs: {
        "aria-label": "Close error overlay",
        "aria-keyshortcuts": "Escape",
        "data-test-id": "OverlayCloseButton",
        [DATA_FOCUS_KEY]: "OverlayCloseButton",
      },
      onclick: closeErrorOverlay,
    },
    closeIcon(),
  );

  const toggleButton = h(HTMLButtonElement, {
    className: CLASS.toggleButton,
    hidden: true,
    attrs: {
      "aria-expanded": "false",
      "aria-keyshortcuts":
        "Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight",
    },
  });

  const panel = h(HTMLDivElement, {
    className: CLASS.panel,
    attrs: {
      role: "group",
      "aria-label": "elm-watch",
      // Using the attribute instead of the property so that it can be
      // selected with `querySelector`.
      tabindex: "-1",
    },
  });

  const root = h(HTMLDivElement, { className: CLASS.root }, toggleButton);

  // The panel is an auto popover, which gives us light dismiss (clicking
  // outside closes it, and the click still reaches the page) and closing with
  // Escape. It is not modal: The page stays usable while it is open. With the
  // emoji button as the invoker, clicking the emoji toggles the panel rather
  // than light dismissing it, and focus returns to the emoji when closing.
  // Browsers without popover support (and JSDOM) get the panel added to and
  // removed from the DOM instead.
  const supportsPopover = typeof panel.showPopover === "function";
  // Set while the browser is in the middle of showing or hiding the panel.
  let isSyncingFromPopover = false;
  if (supportsPopover) {
    panel.popover = "auto";
    toggleButton.popoverTargetElement = panel;
    root.append(panel);
  }

  for (const element of [overlay, overlayAnnouncement, root]) {
    element.lang = "en";
    element.setAttribute("translate", "no");
  }

  topLayer.append(overlay, overlayAnnouncement, root);
  dialog.append(topLayer);
  const shadowRoot = container.attachShadow({ mode: "open" });
  shadowRoot.append(h(HTMLStyleElement, {}, CSS), dialog);
  document.documentElement.append(container);

  const entries: Array<TargetEntry> = [];
  let errorOverlayOpen = false;
  // The errors of each target, in the order they first had errors.
  const overlayErrors = new Map<string, OverlayErrorsEntry>();
  // `targetName` is the target that sent them, which is used for opening
  // errors in the editor.
  let externalErrors: {
    sources: Array<ExternalErrorsSource>;
    sendKey: SendKey | undefined;
    targetName: string;
  } = { sources: [], sendKey: undefined, targetName: "" };
  // Like in the terminal: Errors are shown one at a time by default. Not
  // saved: One at a time should be the default each time.
  let overlayShowAll = false;
  let overlayExpanded = false;
  let overlaySelection: Selection | undefined = undefined;
  // What the overlay showed last time it was rendered, to keep the scroll
  // position when it is still the same.
  let overlayRenderedKey: string | undefined = undefined;
  let panelOpen = false;
  // Set while choosing an editor for opening error locations in.
  let editorChooser: EditorChooser | undefined = undefined;
  // Set when the server failed to open an error location in the editor.
  let openEditorError: string | undefined = undefined;
  // For taking screenshots, for example. Not saved: The emoji is back after
  // reloading the page. It is also back on errors, so that you don’t miss them.
  let hiddenUntilReloadOrError = false;
  let position = loadUiPosition();

  // External errors first, like in the terminal, since they are often the
  // cause of Elm errors (code generation, for example).
  const getAllOverlayErrors = (): Array<OverlayErrorsEntry> => [
    ...externalErrors.sources.map(({ errors }): OverlayErrorsEntry => ({
      errors,
      sendKey: externalErrors.sendKey,
      dispatch: (msg: UiMsg) => {
        dispatchToTarget(externalErrors.targetName, msg);
      },
    })),
    ...overlayErrors.values(),
  ];

  // The errors of all targets put together, without duplicates.
  const getErrorGroup = (): ErrorGroup<OverlayErrorItem> =>
    makeErrorGroup(
      "",
      getAllOverlayErrors().flatMap(({ errors, sendKey, dispatch }) =>
        Array.from(errors, ([id, error]): OverlayErrorItem => ({
          id,
          location: error.location,
          error,
          sendKey,
          dispatch,
        })),
      ),
    );

  const hasErrors = (): boolean =>
    getAllOverlayErrors().some(({ errors }) => errors.size > 0);

  const renderOverlay = (): void => {
    const group = getErrorGroup();
    if (group.numErrors === 0) {
      editorChooser = undefined;
    }
    overlaySelection = reconcile(overlaySelection, [group], new Map());
    const selectedError =
      overlaySelection === undefined
        ? undefined
        : getSelectedError(overlaySelection, [group]);
    const firstError = group.files[0]?.errors[0]?.error;

    if (firstError !== undefined) {
      overlay.style.backgroundColor = firstError.backgroundColor;
      overlay.style.color = firstError.foregroundColor;
      overlay.style.setProperty(
        "--backgroundColor",
        firstError.backgroundColor,
      );
    }

    // Restore focus after re-creating the key hint buttons, so that keyboard
    // users don’t lose their place. If the focus isn’t visible (such as after
    // clicking a button), focus the overlay instead: Focusing a button from
    // script after a key press would show its focus outline.
    const { activeElement } = shadowRoot;
    const focusInOverlay =
      activeElement !== null &&
      activeElement !== overlay &&
      overlay.contains(activeElement);
    const focusKey = focusInOverlay
      ? (activeElement.getAttribute(DATA_FOCUS_KEY) ?? undefined)
      : undefined;
    const focusVisible =
      focusInOverlay && activeElement.matches(":focus-visible");
    const { scrollTop } = overlay;
    // The error ID is JSON, so it can’t be confused with "show all".
    const renderedKey = overlayShowAll ? "show all" : selectedError?.id;

    overlay.replaceChildren(
      overlayCloseButton,
      ...viewOverlay({
        group,
        selection: overlaySelection,
        showAll: overlayShowAll,
        expanded: overlayExpanded,
        onKey: handleOverlayKey,
        onOpenEditor: (item, location) => {
          openEditorForItem(item, location);
        },
        editor: getOverlayEditor(),
        openEditorError,
      }),
    );

    // Start from the top when going to another error.
    overlay.scrollTop = renderedKey === overlayRenderedKey ? scrollTop : 0;
    // Only touch the live region when the text changes, to avoid repeated
    // announcements.
    const announcement = getOverlayAnnouncement(
      group,
      overlayShowAll ? undefined : overlaySelection,
    );
    if (overlayAnnouncement.textContent !== announcement) {
      overlayAnnouncement.textContent = announcement;
    }
    overlayRenderedKey = renderedKey;

    if (focusInOverlay) {
      const element =
        focusKey === undefined || !focusVisible
          ? undefined
          : overlay.querySelector(`[${DATA_FOCUS_KEY}="${focusKey}"]`);
      if (element instanceof HTMLElement && !element.matches(":disabled")) {
        element.focus({ preventScroll: true });
      } else {
        overlay.focus({ preventScroll: true });
      }
    }
  };

  // The errors currently shown in the overlay.
  const getOverlayItems = (): Array<OverlayErrorItem> => {
    const group = getErrorGroup();
    if (overlayShowAll || overlaySelection === undefined) {
      return group.files.flatMap((file) => file.errors);
    }
    const item = getSelectedError(overlaySelection, [group]);
    return item === undefined ? [] : [item];
  };

  // Space scrolls as usual if there is nothing to collapse.
  const canToggleExpanded = (): boolean =>
    !overlayShowAll &&
    overlaySelection !== undefined &&
    getSelectedError(overlaySelection, [getErrorGroup()])?.error
      .htmlContentCollapsed !== undefined;

  const handleOverlayKey = (key: OverlayKey): void => {
    if (openEditorError !== undefined) {
      openEditorError = undefined;
      renderOverlay();
    }
    // The other keys are paused while choosing an editor.
    if (editorChooser !== undefined) {
      if (key === "CancelEditorChooser") {
        closeEditorChooser();
      }
      return;
    }
    switch (key) {
      case "ChangeEditor":
        if (!canChangeEditor(getOverlayItems(), getOverlayEditor())) {
          return;
        }
        if (overlayShowAll || overlaySelection === undefined) {
          openEditorChooser(undefined);
        } else {
          // Open the selected error once chosen.
          openEditorChooser(
            getOverlayOpenEditorLocation(
              getSelectedError(overlaySelection, [getErrorGroup()]),
            ),
          );
        }
        return;

      case "CancelEditorChooser":
        return;

      case "CloseOverlay":
        closeErrorOverlay();
        return;

      case "ToggleShowAll":
        overlayShowAll = !overlayShowAll;
        break;

      case "ToggleExpanded":
        if (!canToggleExpanded()) {
          return;
        }
        overlayExpanded = !overlayExpanded;
        break;

      case "OpenEditor": {
        if (overlayShowAll || overlaySelection === undefined) {
          return;
        }
        const item = getSelectedError(overlaySelection, [getErrorGroup()]);
        const location = getOverlayOpenEditorLocation(item);
        if (item !== undefined && location !== undefined) {
          openEditorForItem(item, location);
        }
        return;
      }

      default:
        if (overlayShowAll || overlaySelection === undefined) {
          return;
        }
        overlaySelection = navigate(overlaySelection, [getErrorGroup()], key);
    }
    renderOverlay();
  };

  const getSnapshots = (): Array<TargetSnapshot> =>
    entries.flatMap((entry) =>
      entry.snapshot === undefined ? [] : [entry.snapshot],
    );

  const dispatchToTarget = (targetName: string, msg: UiMsg): void => {
    entries
      .find((entry) => entry.targetName === targetName)
      ?.callbacks?.onUiMsg(msg);
  };

  // All targets get the same from the server. To choose an editor, we need a
  // target that is connected.
  const getOpenEditor = ():
    | {
        openEditor: OpenEditorSetup;
        connectedTarget: { targetName: string; sendKey: SendKey } | undefined;
      }
    | undefined => {
    const snapshots = getSnapshots();
    const openEditor = snapshots.find(
      (snapshot) => snapshot.openEditor !== undefined,
    )?.openEditor;
    if (openEditor === undefined) {
      return undefined;
    }
    const connected = snapshots.find(
      (snapshot) =>
        snapshot.openEditor !== undefined && snapshot.sendKey !== undefined,
    );
    return {
      openEditor,
      connectedTarget:
        connected?.sendKey === undefined
          ? undefined
          : {
              targetName: connected.info.targetName,
              sendKey: connected.sendKey,
            },
    };
  };

  // Opening the URL in the click (or keydown) handler counts as a user
  // action, which browsers require for opening other apps.
  const openUrl = (url: string): void => {
    const link = h(HTMLAnchorElement, { href: url });
    root.append(link);
    link.click();
    link.remove();
  };

  // Opens the location using `ELM_WATCH_OPEN_EDITOR`.
  const openWithEnv = (
    env: OpenEditorEnv | undefined,
    location: LocationToOpen,
    dispatch: ((msg: UiMsg) => void) | undefined,
    sendKey: SendKey | undefined,
  ): void => {
    switch (env?.tag) {
      case "Url":
        openUrl(editorUrl(env.template, location));
        return;

      // `undefined`: Haven’t heard from the server yet. Let it decide.
      case "Server":
      case undefined:
        if (dispatch !== undefined && sendKey !== undefined) {
          dispatch({
            tag: "PressedOpenEditor",
            file: location.file,
            line: location.line,
            column: location.column,
            sendKey,
          });
        }
        return;
    }
  };

  const openEditorForItem = (
    item: OverlayErrorItem,
    location: LocationToOpen,
  ): void => {
    if (openEditorError !== undefined) {
      openEditorError = undefined;
      renderOverlay();
    }
    const openEditor = getOpenEditor()?.openEditor;
    const preset =
      openEditor?.preset === null || openEditor === undefined
        ? undefined
        : findPreset(openEditor.preset);
    if (preset !== undefined) {
      openUrl(editorUrl(preset.template, location));
    } else if (openEditor?.env === null) {
      openEditorChooser(location);
    } else {
      openWithEnv(
        openEditor?.env ?? undefined,
        location,
        item.dispatch,
        item.sendKey,
      );
    }
  };

  const canChooseEditor = (): boolean =>
    getOpenEditor()?.connectedTarget !== undefined;

  const openEditorChooser = (location: LocationToOpen | undefined): void => {
    if (!canChooseEditor()) {
      return;
    }
    const current = getCurrentPreset();
    const envSet = isEnvSet();
    editorChooser = { location, showOther: false };
    renderOverlay();
    const element = overlay.querySelector(
      current === undefined && envSet
        ? `[${DATA_FOCUS_KEY}="editorOther"]`
        : `[${DATA_FOCUS_KEY}="editor:${current?.id ?? EDITOR_PRESETS[0]?.id ?? ""}"]`,
    );
    if (element instanceof HTMLElement) {
      element.focus({ preventScroll: true });
    }
  };

  const showOtherEditor = (): void => {
    if (editorChooser === undefined) {
      return;
    }
    editorChooser.showOther = true;
    renderOverlay();
  };

  const closeEditorChooser = (): void => {
    editorChooser = undefined;
    renderOverlay();
  };

  const chooseEditor = (editorString: string | null): void => {
    const result = getOpenEditor();
    const connectedTarget = result?.connectedTarget;
    const preset = editorString === null ? undefined : findPreset(editorString);
    if (
      connectedTarget === undefined ||
      (editorString !== null && preset === undefined)
    ) {
      return;
    }
    const location = editorChooser?.location;
    editorChooser = undefined;
    if (location !== undefined) {
      if (preset === undefined) {
        openWithEnv(
          result?.openEditor.env ?? undefined,
          location,
          (msg) => {
            dispatchToTarget(connectedTarget.targetName, msg);
          },
          connectedTarget.sendKey,
        );
      } else {
        openUrl(editorUrl(preset.template, location));
      }
    }
    dispatchToTarget(connectedTarget.targetName, {
      tag: "ChoseEditor",
      editor: editorString,
      sendKey: connectedTarget.sendKey,
    });
    renderOverlay();
  };

  const getCurrentPreset = (): EditorPreset | undefined => {
    const preset = getOpenEditor()?.openEditor.preset ?? null;
    return preset === null ? undefined : findPreset(preset);
  };

  const isEnvSet = (): boolean =>
    (getOpenEditor()?.openEditor.env ?? null) !== null;

  const getOverlayEditor = (): OverlayEditor => {
    const result = getOpenEditor();
    const current = getCurrentPreset();
    const envSet = isEnvSet();
    return {
      current,
      envSet,
      chooser:
        editorChooser === undefined || result === undefined
          ? undefined
          : {
              ...editorChooser,
              current,
              envSet,
              onChoose: chooseEditor,
              onShowOther: showOtherEditor,
            },
    };
  };

  const render = (): void => {
    const snapshots = getSnapshots();
    const externalSources = externalErrors.sources.map(({ source }) => source);
    const worst = worstStatus(snapshots, externalSources);
    const someError = (worst?.severity ?? 0) >= ERROR_SEVERITY;
    if (someError) {
      hiddenUntilReloadOrError = false;
    }
    const hidden = snapshots.length === 0 || hiddenUntilReloadOrError;
    toggleButton.hidden = hidden;
    toggleButton.setAttribute("aria-expanded", panelOpen.toString());
    toggleButton.setAttribute(
      "aria-label",
      summaryLabel(snapshots, externalSources),
    );

    const flashElement = toggleButton.querySelector(`.${CLASS.flash}`);
    toggleButton.replaceChildren(
      flashElement ??
        h(HTMLSpanElement, {
          className: CLASS.flash,
          onanimationend: (event) => {
            // The animations are designed to work even without this (they
            // stay on the last frame). We also have `pointer-events: none`.
            // But remove the absolutely positioned animation element just
            // in case.
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.removeAttribute("data-flash");
            }
          },
        }),
      h(HTMLSpanElement, { className: CLASS.toggleEmoji }, worst?.icon ?? ""),
      ...(snapshots.some((snapshot) => snapshot.compilationMode === "optimize")
        ? [
            h(
              HTMLSpanElement,
              { className: CLASS.badge },
              h(HTMLSpanElement, {}, "🚀"),
            ),
          ]
        : []),
    );

    if (panelOpen && !hidden) {
      renderPanel(snapshots, someError);
      if (!supportsPopover) {
        if (!panel.isConnected) {
          root.append(panel);
        }
      } else if (!isSyncingFromPopover && !panel.matches(":popover-open")) {
        panel.showPopover();
      }
    } else {
      if (!supportsPopover) {
        panel.remove();
      } else if (!isSyncingFromPopover && panel.matches(":popover-open")) {
        panel.hidePopover();
      }
      panel.replaceChildren();
    }
  };

  // The browser opens and closes the popover by itself: When clicking the
  // emoji (the invoker), on light dismiss and on Escape. `beforetoggle` fires
  // before the panel is shown, so it can be rendered first.
  panel.addEventListener("beforetoggle", (event) => {
    const open = event.newState === "open";
    if (open === panelOpen) {
      return;
    }
    panelOpen = open;
    isSyncingFromPopover = true;
    try {
      render();
    } finally {
      isSyncingFromPopover = false;
    }
  });

  const renderPanel = (
    snapshots: Array<TargetSnapshot>,
    someError: boolean,
  ): void => {
    // The panel is re-created on every render. Restore focus afterwards, so
    // that keyboard users don’t lose their place.
    const { activeElement } = shadowRoot;
    const focusKey =
      activeElement === panel
        ? "panel"
        : (activeElement?.getAttribute(DATA_FOCUS_KEY) ?? undefined);
    // Only the targets scroll (between the header and the footer).
    const scrollTop = panel.querySelector(`.${CLASS.targets}`)?.scrollTop ?? 0;

    panel.replaceChildren(
      ...viewPanel({
        snapshots,
        externalErrors: externalErrors.sources,
        hasErrors: hasErrors(),
        errorOverlayOpen,
        onToggleErrorOverlay: () => {
          // Close the panel, so that it does not cover the errors.
          panelOpen = false;
          setErrorOverlayOpen(!errorOverlayOpen);
          render();
        },
        // Hiding is pointless when there are errors, since they show the
        // emoji again right away.
        onHide: someError
          ? undefined
          : () => {
              panelOpen = false;
              hiddenUntilReloadOrError = true;
              render();
            },
        onClose: closePanel,
        dispatch: dispatchToTarget,
      }),
    );

    const targets = panel.querySelector(`.${CLASS.targets}`);
    if (targets !== null) {
      targets.scrollTop = scrollTop;
    }

    if (focusKey !== undefined && focusKey !== "panel") {
      const element = Array.from(
        panel.querySelectorAll(`[${DATA_FOCUS_KEY}]`),
      ).find(
        (candidate) => candidate.getAttribute(DATA_FOCUS_KEY) === focusKey,
      );
      if (element instanceof HTMLElement && !element.matches(":disabled")) {
        element.focus({ preventScroll: true });
      } else {
        // For example, the compilation mode radio buttons are disabled while
        // compiling.
        panel.focus({ preventScroll: true });
      }
    }
  };

  const closePanel = (): void => {
    panelOpen = false;
    render();
    toggleButton.focus();
  };

  const isErrorOverlayVisible = (): boolean => errorOverlayOpen && hasErrors();

  const updateErrorOverlayVisibility = (): void => {
    const hidden = !isErrorOverlayVisible();
    overlay.hidden = hidden;
    overlayAnnouncement.hidden = hidden;

    // elm-watch’s overlay needs to be a modal `<dialog>` for two reasons:
    // - It makes sure you cannot interact with elements behind it.
    // - We need it to win against other modal `<dialog>`s on the page – they make
    //   all other content on the page, including our overlay, inert.
    // Support for `<dialog>` shipped in Firefox and Safari in 2022-03-14.
    // These methods are not supported in JSDOM, so we only call them if they exist.
    if (
      typeof dialog.close === "function" &&
      typeof dialog.showModal === "function" &&
      // Support users removing elm-watch’s UI (`.showModal()` throws an error in that case).
      dialog.isConnected
    ) {
      // A modal dialog makes the page inert, even if it is not rendered. So
      // when the page hides elm-watch’s UI (`#elm-watch2 { display: none }`),
      // don’t make the page impossible to interact with. (The container is
      // `display: inline` by default, via `all: initial`.)
      if (hidden || window.getComputedStyle(container).display === "none") {
        dialog.close();
      } else if (!dialog.open) {
        dialog.showModal();
        overlay.focus({ preventScroll: true });
      }
    }

    moveToTopLayer(dialog, topLayer);
  };

  const setErrorOverlayOpen = (open: boolean): void => {
    if (open === errorOverlayOpen) {
      return;
    }
    errorOverlayOpen = open;
    if (
      !open &&
      (editorChooser !== undefined || openEditorError !== undefined)
    ) {
      editorChooser = undefined;
      openEditorError = undefined;
      renderOverlay();
    }
    updateErrorOverlayVisibility();
    // The “Show errors” / “Hide errors” button needs updating.
    render();
  };

  const applyUiPosition = (): void => {
    root.style.setProperty("--y", position.y.toString());
    root.classList.toggle(CLASS.rootRight, position.side === "right");
    root.classList.toggle(CLASS.rootBottomHalf, position.y > 0.5);
    root.classList.toggle(CLASS.rootTopEdge, position.y === 0);
    root.classList.toggle(CLASS.rootBottomEdge, position.y === 1);
  };

  // `from` is where the emoji was before the move, for the animation.
  const setUiPosition = (newPosition: UiPosition, from: DOMRect): void => {
    position = newPosition;
    applyUiPosition();
    saveUiPosition(newPosition);
    animateToggleButtonFrom(from);
  };

  let moveAnimation: Animation | undefined = undefined;

  // FLIP animation: The emoji is already at its new position. Move it back to
  // where it was with a transform, and animate that transform away. (Changing
  // between `left` and `right` cannot be transitioned with CSS.) The panel is
  // hidden until the emoji has arrived, so it does not show up at the new
  // position too early.
  const animateToggleButtonFrom = (from: DOMRect): void => {
    moveAnimation?.cancel();
    moveAnimation = undefined;
    const to = toggleButton.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (
      (dx === 0 && dy === 0) ||
      typeof toggleButton.animate !== "function" ||
      prefersReducedMotion()
    ) {
      root.classList.remove(CLASS.rootMoving);
      return;
    }
    root.classList.add(CLASS.rootMoving);
    // Overshoot a little past the target. The overshoot is capped, so that
    // long moves don't end up outside the window.
    const distance = Math.hypot(dx, dy);
    const overshoot =
      Math.min(MOVE_ANIMATION_MAX_OVERSHOOT, distance * 0.05) / distance;
    const animation = toggleButton.animate(
      [
        {
          transform: `translate(${dx}px, ${dy}px)`,
          easing: "cubic-bezier(0.2, 0.8, 0.4, 1)",
        },
        {
          transform: `translate(${-dx * overshoot}px, ${-dy * overshoot}px)`,
          offset: 0.75,
          easing: "ease-in-out",
        },
        { transform: "none" },
      ],
      { duration: MOVE_ANIMATION_DURATION },
    );
    animation.onfinish = () => {
      if (moveAnimation === animation) {
        moveAnimation = undefined;
        root.classList.remove(CLASS.rootMoving);
      }
    };
    moveAnimation = animation;
  };

  applyUiPosition();

  toggleButton.onclick = (event) => {
    if (drag.tag === "JustDropped") {
      drag = { tag: "Idle" };
      // Don’t let the browser toggle the popover either.
      event.preventDefault();
      return;
    }
    // With popover support, the browser toggles the panel (see
    // `beforetoggle`).
    if (!supportsPopover) {
      panelOpen = !panelOpen;
      render();
    }
  };

  // Dragging works like the floating button in Expo’s developer menu: The
  // emoji follows the pointer, and snaps to the closest side when released.
  let drag:
    | { tag: "Idle" }
    | {
        tag: "Pressed";
        pointerId: number;
        startX: number;
        startY: number;
        offsetX: number;
        offsetY: number;
      }
    | {
        tag: "Dragging";
        pointerId: number;
        // Where the pointer should be relative to the emoji’s position in
        // the layout, which is not changed while dragging.
        offsetX: number;
        offsetY: number;
      }
    | { tag: "JustDropped" } = { tag: "Idle" };

  toggleButton.onpointerdown = (event) => {
    if (!event.isPrimary || event.button !== 0) {
      return;
    }
    const rect = toggleButton.getBoundingClientRect();
    drag = {
      tag: "Pressed",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    // Keep getting pointer events even when the pointer quickly leaves the
    // button. The click event still fires as usual.
    toggleButton.setPointerCapture(event.pointerId);
  };

  toggleButton.onpointermove = (event) => {
    switch (drag.tag) {
      case "Idle":
      case "JustDropped":
        return;

      case "Pressed":
        if (
          drag.pointerId !== event.pointerId ||
          Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
            DRAG_THRESHOLD
        ) {
          return;
        }
        {
          // Grab the emoji where it is, even if it is still on its way
          // somewhere (the offset was measured including the animation).
          moveAnimation?.cancel();
          moveAnimation = undefined;
          root.classList.remove(CLASS.rootMoving);
          root.classList.add(CLASS.rootDragging);
          const layoutRect = toggleButton.getBoundingClientRect();
          drag = {
            tag: "Dragging",
            pointerId: drag.pointerId,
            offsetX: drag.offsetX + layoutRect.left,
            offsetY: drag.offsetY + layoutRect.top,
          };
          break;
        }

      case "Dragging":
        if (drag.pointerId !== event.pointerId) {
          return;
        }
        break;
    }
    // Using `transform` rather than `left` and `top`, so that the browser
    // only needs to move an already painted layer (see `will-change`). That
    // makes the emoji keep up better with the pointer.
    toggleButton.style.transform = `translate(${event.clientX - drag.offsetX}px, ${event.clientY - drag.offsetY}px)`;
  };

  const endDrag = (event: PointerEvent, save: boolean): void => {
    if (drag.tag === "Pressed") {
      drag = { tag: "Idle" };
      return;
    }
    if (drag.tag !== "Dragging" || drag.pointerId !== event.pointerId) {
      return;
    }
    const rect = toggleButton.getBoundingClientRect();
    toggleButton.style.transform = "";
    root.classList.remove(CLASS.rootDragging);
    // A click event follows `pointerup`. It should not toggle the panel.
    drag = save ? { tag: "JustDropped" } : { tag: "Idle" };
    if (save) {
      setUiPosition(
        {
          side:
            rect.left + rect.width / 2 < window.innerWidth / 2
              ? "left"
              : "right",
          y: topToY(rect.top),
        },
        rect,
      );
    } else {
      // Go back to where it was.
      animateToggleButtonFrom(rect);
    }
  };

  toggleButton.onpointerup = (event) => {
    endDrag(event, true);
  };

  toggleButton.onpointercancel = (event) => {
    endDrag(event, false);
  };

  // Converts the top of the emoji button (in pixels) to a `y` value, by
  // measuring where the button ends up at the top and bottom.
  const topToY = (top: number): number => {
    const previousY = root.style.getPropertyValue("--y");
    root.style.setProperty("--y", "0");
    const minTop = toggleButton.getBoundingClientRect().top;
    root.style.setProperty("--y", "1");
    const maxTop = toggleButton.getBoundingClientRect().top;
    root.style.setProperty("--y", previousY);
    return maxTop > minTop ? clamp01((top - minTop) / (maxTop - minTop)) : 0;
  };

  root.onkeydown = (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "Escape" && !event.shiftKey && panelOpen) {
      // Don’t let this Escape re-open the error overlay.
      event.preventDefault();
      event.stopPropagation();
      closePanel();
      return;
    }

    if (!event.shiftKey) {
      return;
    }

    const newPosition = ((): UiPosition | undefined => {
      switch (event.key) {
        case "ArrowLeft":
          return { ...position, side: "left" };
        case "ArrowRight":
          return { ...position, side: "right" };
        case "ArrowUp":
          return { ...position, y: stepY(position.y, -1) };
        case "ArrowDown":
          return { ...position, y: stepY(position.y, 1) };
        default:
          return undefined;
      }
    })();

    if (newPosition !== undefined) {
      // Also stops the arrow keys from changing the compilation mode radio
      // buttons.
      event.preventDefault();
      setUiPosition(newPosition, toggleButton.getBoundingClientRect());
    }
  };

  // While the error overlay is open, the page is inert, so we can take
  // Escape and the error navigation keys for ourselves.
  const onKeydownCapture = (event: KeyboardEvent): void => {
    if (!isErrorOverlayVisible()) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (editorChooser === undefined) {
        closeErrorOverlay();
      } else {
        closeEditorChooser();
      }
      return;
    }
    const digit =
      editorChooser !== undefined &&
      /^[1-9]$/.test(event.key) &&
      !(shadowRoot.activeElement instanceof HTMLInputElement)
        ? Number(event.key)
        : undefined;
    if (digit !== undefined && digit <= EDITOR_PRESETS.length + 1) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const preset = EDITOR_PRESETS[digit - 1];
      if (preset !== undefined) {
        chooseEditor(preset.id);
      } else if (isEnvSet()) {
        chooseEditor(null);
      } else {
        showOtherEditor();
      }
      return;
    }
    const key = overlayKeyFromEvent(event);
    if (
      key === undefined ||
      // Let the user type in text fields.
      (shadowRoot.activeElement instanceof HTMLInputElement &&
        shadowRoot.activeElement.type === "text") ||
      (key === "ToggleExpanded" && !canToggleExpanded()) ||
      // Let Enter and Space press the focused button.
      ((event.key === "Enter" || event.key === " ") &&
        shadowRoot.activeElement instanceof HTMLButtonElement)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    handleOverlayKey(key);
  };

  // Pressing Escape again re-opens the error overlay. The page might use
  // Escape too, though, so this listens in the bubble phase, and stays away
  // if the page handled the event, or if it looks like Escape is likely to be
  // meant for the page.
  const onKeydownBubble = (event: KeyboardEvent): void => {
    if (
      event.key !== "Escape" ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isEscapeLikelyForThePage()
    ) {
      return;
    }
    if (panelOpen) {
      // Escape inside the panel is handled by `root.onkeydown`. But Safari
      // does not focus buttons when clicking them, so after opening the panel
      // with the mouse, Escape ends up here instead.
      event.preventDefault();
      panelOpen = false;
      render();
    } else if (!errorOverlayOpen && hasErrors()) {
      // Otherwise the browser closes the dialog right away again, as the
      // default action of pressing Escape.
      event.preventDefault();
      setErrorOverlayOpen(true);
    }
  };

  // When the page opens a popover, modal dialog etc., they end up on top of
  // elm-watch. Move elm-watch back to the top when that happens. `toggle` does
  // not bubble, so listen in the capture phase. Dialogs fire `toggle` in newer
  // browsers only, so also listen for `close` (to remove the inactive state).
  // (Our own popovers are in the shadow root, and `toggle` does not propagate
  // out of it, so this does not react to our own moves.)
  // Cap the number of moves per frame, in case some other script on the page
  // also tries to stay on top this way, which would cause an infinite loop.
  let movesThisFrame = 0;
  const onTopLayerChange = (): void => {
    if (movesThisFrame >= 10) {
      return;
    }
    if (movesThisFrame === 0) {
      requestAnimationFrame(() => {
        movesThisFrame = 0;
      });
    }
    movesThisFrame++;
    moveToTopLayer(dialog, topLayer);
  };

  const flash = (flashType: FlashType): void => {
    const element = toggleButton.querySelector(`.${CLASS.flash}`);
    if (element instanceof HTMLElement) {
      // Restart the animation if it is already running.
      element.removeAttribute("data-flash");
      void element.offsetWidth;
      element.setAttribute("data-flash", flashType);
    }
  };

  const addListeners = (): void => {
    window.addEventListener("keydown", onKeydownCapture, true);
    window.addEventListener("keydown", onKeydownBubble);
    document.addEventListener("toggle", onTopLayerChange, true);
    document.addEventListener("close", onTopLayerChange, true);
  };

  // Called when the last target unregisters. The DOM elements are left as-is,
  // so they can be inspected after `__ELM_WATCH.KILL_MATCHING` (used in tests).
  const removeListeners = (): void => {
    window.removeEventListener("keydown", onKeydownCapture, true);
    window.removeEventListener("keydown", onKeydownBubble);
    document.removeEventListener("toggle", onTopLayerChange, true);
    document.removeEventListener("close", onTopLayerChange, true);
  };

  return {
    register: (targetName) => {
      const entry: TargetEntry = {
        targetName,
        callbacks: undefined,
        snapshot: undefined,
      };
      if (entries.length === 0) {
        addListeners();
      }
      entries.push(entry);

      return {
        subscribe: (callbacks) => {
          entry.callbacks = callbacks;
          return () => {
            entry.callbacks = undefined;
          };
        },

        render: (snapshot) => {
          entry.snapshot = snapshot;
          render();
          moveToTopLayer(dialog, topLayer);
        },

        flash,

        setErrors: (errors, sendKey, { open }) => {
          if (errors.size === 0) {
            overlayErrors.delete(entry.targetName);
          } else {
            overlayErrors.set(entry.targetName, {
              errors,
              sendKey,
              dispatch: (msg) => {
                entry.callbacks?.onUiMsg(msg);
              },
            });
          }
          renderOverlay();
          if (open && !errorOverlayOpen) {
            setErrorOverlayOpen(true);
          } else {
            updateErrorOverlayVisibility();
            render();
          }
        },

        setExternalErrors: (sources, sendKey) => {
          const previousIds = new Set(
            externalErrors.sources.flatMap(({ errors }) =>
              Array.from(errors.keys()),
            ),
          );
          const hasNewErrors = sources.some(({ errors }) =>
            Array.from(errors.keys()).some((id) => !previousIds.has(id)),
          );
          externalErrors = { sources, sendKey, targetName: entry.targetName };
          renderOverlay();
          if (hasNewErrors) {
            flash("error");
          }
          if (hasNewErrors && !errorOverlayOpen) {
            setErrorOverlayOpen(true);
          } else {
            updateErrorOverlayVisibility();
            render();
          }
        },

        openPanel: () => {
          panelOpen = true;
          render();
        },

        showOpenEditorError: (message) => {
          openEditorError = message;
          renderOverlay();
          if (!errorOverlayOpen) {
            setErrorOverlayOpen(true);
          }
        },

        unregister: () => {
          const index = entries.indexOf(entry);
          if (index === -1) {
            return;
          }
          entries.splice(index, 1);
          // Open external errors in the editor via another target.
          if (externalErrors.targetName === entry.targetName) {
            externalErrors = {
              ...externalErrors,
              targetName: entries[0]?.targetName ?? "",
            };
          }
          render();
          if (entries.length === 0) {
            removeListeners();
          }
        },
      };
    },
  };
}

function loadUiPosition(): UiPosition {
  try {
    const stored = window.localStorage.getItem(UI_POSITION_STORAGE_KEY);
    if (stored !== null) {
      const result = Codec.JSON.parse(UiPosition, stored);
      if (result.tag === "Valid" && Number.isFinite(result.value.y)) {
        return { ...result.value, y: clamp01(result.value.y) };
      }
    }
  } catch {
    // localStorage might not be available.
  }
  return DEFAULT_UI_POSITION;
}

function saveUiPosition(position: UiPosition): void {
  try {
    window.localStorage.setItem(
      UI_POSITION_STORAGE_KEY,
      Codec.JSON.stringify(UiPosition, position),
    );
  } catch {
    // localStorage might not be available.
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function clamp01(number: number): number {
  return Math.min(1, Math.max(0, number));
}

function stepY(y: number, direction: -1 | 1): number {
  // Snap to the steps, in case `y` is somewhere in between after dragging.
  const steps = 1 / KEYBOARD_STEP;
  const current = y * steps;
  const next =
    direction === 1
      ? Math.floor(current + 1e-9) + 1
      : Math.ceil(current - 1e-9) - 1;
  return clamp01(next / steps);
}

function isEscapeLikelyForThePage(): boolean {
  const { activeElement } = document;
  if (
    activeElement instanceof HTMLElement &&
    (activeElement.isContentEditable ||
      activeElement.matches("input, textarea, select"))
  ) {
    return true;
  }
  try {
    // Escape closes modal dialogs and popovers (by default). At this point,
    // they have not been closed yet. (This does not find our own popovers,
    // since they are in the shadow root.)
    return document.querySelector(":modal, :popover-open") !== null;
  } catch {
    // `:modal` or `:popover-open` is not supported.
    return false;
  }
}

function moveToTopLayer(
  dialog: HTMLDialogElement,
  topLayer: HTMLElement,
): void {
  // Put elm-watch’s UI in the top level. This is needed to stay on top of
  // popovers. See: https://developer.mozilla.org/en-US/docs/Glossary/Top_layer
  // The latest shown popover gets drawn on top, so we need to enter and exit
  // popover frequently for elm-watch to force it to be on the very top.
  // `.showPopover()` shipped in Firefox 125, released 2024-04-16. Older
  // browsers and JSDOM (used in the tests) don’t have it, so we only call the
  // methods if they exist. The element falls back to having the highest
  // z-index.
  if (
    typeof topLayer.hidePopover === "function" &&
    typeof topLayer.showPopover === "function" &&
    // Support users removing elm-watch’s UI (`.showPopover()` throws an error in that case).
    topLayer.isConnected
  ) {
    topLayer.hidePopover();
    topLayer.showPopover();
  }

  // A modal dialog on the page makes everything outside it inert, including
  // elm-watch – even though we are drawn on top. Show that elm-watch cannot be
  // interacted with in that case (unless our own dialog is the modal one).
  let isInert = false;
  try {
    isInert =
      document.querySelector(":modal") !== null && !dialog.matches(":modal");
  } catch {
    // `:modal` is not supported.
  }
  topLayer.style.opacity = isInert ? "0.5" : "";
}

export function retryWaitMs(attemptNumber: number): number {
  // At least 1010 ms, at most 1 minute.
  return Math.min(1000 + 10 * attemptNumber ** 2, 1000 * 60);
}

function printRetryWaitMs(attemptNumber: number): string {
  return `${retryWaitMs(attemptNumber) / 1000} seconds`;
}

function h<T extends HTMLElement>(
  t: new () => T,
  {
    attrs,
    style,
    localName,
    ...props
  }: Partial<
    Omit<T, "style"> & {
      attrs: Record<string, string>;
      style: Partial<CSSStyleDeclaration>;
    }
  >,
  ...children: Array<Node | string | undefined>
): T {
  const element = document.createElement(
    localName ??
      t.name
        .replace(/^HTML(\w+)Element$/, "$1")
        .replace("Anchor", "a")
        .replace("Paragraph", "p")
        .replace(/^([DOU])List$/, "$1l")
        .toLowerCase(),
  ) as T;

  Object.assign(element, props);

  if (attrs !== undefined) {
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
  }

  if (style !== undefined) {
    for (const [key, value] of Object.entries(style)) {
      (element.style as unknown as Record<string, string>)[key] = value;
    }
  }

  for (const child of children) {
    if (child !== undefined) {
      element.append(
        typeof child === "string" ? document.createTextNode(child) : child,
      );
    }
  }

  return element;
}

function svg(
  localName: string,
  attrs: Record<string, string>,
  ...children: Array<SVGElement>
): SVGElement {
  const element = document.createElementNS(
    "http://www.w3.org/2000/svg",
    localName,
  );
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  element.append(...children);
  return element;
}

// An eye with a slash through it.
function hideIcon(): SVGElement {
  return svg(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    svg("path", {
      d: "M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z",
    }),
    svg("circle", { cx: "8", cy: "8", r: "2" }),
    svg("path", { d: "M2.5 2.5l11 11" }),
  );
}

function closeIcon(): SVGElement {
  return svg(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: "16",
      height: "16",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.5",
      "stroke-linecap": "round",
      "aria-hidden": "true",
    },
    svg("path", { d: "M4 4l8 8M12 4l-8 8" }),
  );
}

export type Info = {
  version: string;
  webSocketUrl: URL;
  targetName: string;
  originalCompilationMode: CompilationModeWithProxy;
  debugModeToggled: Toggled;
};

const CLASS = {
  badge: "badge",
  button: "button",
  iconButton: "iconButton",
  details: "details",
  dialog: "dialog",
  dim: "dim",
  editorChooser: "editorChooser",
  editorChooserOptions: "editorChooserOptions",
  errorLocationButton: "errorLocationButton",
  errorTitle: "errorTitle",
  errorTitleLocation: "errorTitleLocation",
  errorTitleSpacer: "errorTitleSpacer",
  flash: "flash",
  footer: "footer",
  header: "header",
  modes: "modes",
  note: "note",
  overlay: "overlay",
  overlayCloseButton: "overlayCloseButton",
  overlayBottom: "overlayBottom",
  overlayError: "overlayError",
  overlayErrorHeader: "overlayErrorHeader",
  overlayFooter: "overlayFooter",
  overlayKeyHint: "overlayKeyHint",
  overlayKeyHintNote: "overlayKeyHintNote",
  overlayKeyHints: "overlayKeyHints",
  overlayNotice: "overlayNotice",
  overlayPosition: "overlayPosition",
  panel: "panel",
  root: "root",
  rootBottomEdge: "rootBottomEdge",
  rootBottomHalf: "rootBottomHalf",
  rootDragging: "rootDragging",
  rootMoving: "rootMoving",
  rootRight: "rootRight",
  rootTopEdge: "rootTopEdge",
  row: "row",
  rowIcon: "rowIcon",
  rowText: "rowText",
  statusLine: "statusLine",
  target: "target",
  targetName: "targetName",
  targets: "targets",
  title: "title",
  toggleButton: "toggleButton",
  toggleEmoji: "toggleEmoji",
  topLayer: "topLayer",
  version: "version",
  visuallyHidden: "visuallyHidden",
};

const DATA_FOCUS_KEY = "data-focus-key";

export type FlashType = "error" | "success";

// The size of the emoji button. For touch, the hit area is enlarged to the
// recommended minimum touch target size (see `TOUCH_SIZE`).
const TOGGLE_SIZE = "22px";
const TOUCH_SIZE = "44px";

// The first error in the error overlay starts just below the close button.
const OVERLAY_CLOSE_BUTTON_SIZE = "48px";

const CSS = `
/* Custom properties are not reset by \`all: initial\` below. */
:host {
  --monospace: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
}

input,
button,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  color: inherit;
  margin: 0;
}

p {
  margin: 0;
}

/*
\`all: initial\` overrides the default dialog styles. Even when closed, the
dialog is displayed (\`display: inline\`), since it contains all of the UI.
*/
.${CLASS.dialog} {
  all: initial;
}

/*
\`all: initial\` overrides the default popover styles. \`all\` does not reset
\`direction\`, so a right-to-left page would otherwise mirror elm-watch’s UI
(and mess up the punctuation in error messages). The z-index is the maximum
supported by browsers, for browsers without popover support.
*/
.${CLASS.topLayer} {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483647;
  direction: ltr;
}

[hidden] {
  display: none !important;
}

.${CLASS.overlay} {
  position: fixed;
  z-index: -2;
  inset: 0;
  overflow-y: auto;
  /* The footer sticks to the bottom, even if the error is short. */
  display: flex;
  flex-direction: column;
  user-select: text;
  pointer-events: auto;
}

.${CLASS.overlay} > * {
  flex-shrink: 0;
}

/* Browsers make scrollable elements focusable, and the dialog focuses the
   overlay when it opens. An outline around the whole window is just noise. */
.${CLASS.overlay}:focus-visible {
  outline: none;
}

/* Like the borders in the overlay, rather than the browser default. */
.${CLASS.overlay} :focus-visible {
  outline: 0.125em solid currentColor;
  outline-offset: 0.25em;
}

/* Sticking to the top right of the overlay’s content box keeps the button the
   same distance from the edges, whether there is a scrollbar or not. */
.${CLASS.overlayCloseButton} {
  position: sticky;
  z-index: 1;
  top: 0;
  align-self: flex-end;
  /* Overlap the top margin of the first error. */
  margin-bottom: -2ch;
  appearance: none;
  display: grid;
  place-items: center;
  width: ${OVERLAY_CLOSE_BUTTON_SIZE};
  height: ${OVERLAY_CLOSE_BUTTON_SIZE};
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  filter: drop-shadow(0 0 2px var(--backgroundColor));
}

/* Hug the icon rather than the whole (large) hit area. */
.${CLASS.overlayCloseButton}:focus-visible {
  outline-offset: -10px;
}

.${CLASS.overlayCloseButton} svg {
  width: 20px;
  height: 20px;
}

.${CLASS.overlay},
.${CLASS.overlay} pre {
  font-family: var(--monospace);
}

.${CLASS.overlayError} {
  --border-thickness: 0.125em;
  border-top: var(--border-thickness) solid;
  margin: 2ch 0;
}

.${CLASS.overlayErrorHeader} {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  padding: 0 2ch;
  word-break: break-word;
  /* The location is right-aligned at the same width as in the terminal. */
  max-width: 100ch;
  box-sizing: border-box;
}

/* Pushes the location to the right. When the location doesn’t fit, it wraps
   and starts at the left, while the spacer stays on the title’s line. At
   least as much of the border as the “──” between the title and the location
   in the terminal is shown. */
.${CLASS.errorTitleSpacer} {
  flex: 1 0 2ch;
}

.${CLASS.errorTitle},
.${CLASS.errorTitleLocation} {
  display: inline-block;
  font-weight: bold;
  --padding: 1ch;
  padding: 0 var(--padding);
  transform: translate(calc(var(--padding) * -1), calc(-50% - var(--border-thickness) / 2));
}

.${CLASS.errorTitleLocation} {
  font-weight: normal;
  min-width: 0;
}

.${CLASS.dim} {
  opacity: 0.6;
}

.${CLASS.errorLocationButton} {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  /* A faint underline hints that the location is clickable, without being as
     loud as a full underline on every error. */
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent);
  text-underline-offset: 0.25em;
  cursor: pointer;
}

.${CLASS.errorLocationButton}:hover {
  text-decoration-color: currentColor;
}

.${CLASS.overlay} pre [data-expand] {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  opacity: 0.6;
  cursor: pointer;
}

.${CLASS.overlay} pre [data-expand]:hover {
  text-decoration: underline;
}

.${CLASS.overlay} pre {
  margin: 0;
  padding: 2ch;
  overflow-x: auto;
}

/* The footer, and the editor chooser above it, stick to the bottom, so that the
   chooser is visible even if the error is long. */
.${CLASS.overlayBottom} {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  max-height: 100%;
  background-color: inherit;
}

.${CLASS.overlayFooter} {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  /* Otherwise the emoji makes the position text taller than the key hints. */
  line-height: 1.5;
  gap: 1ch 3ch;
  /* Room for the emoji button, which can be on either side. */
  padding: 1ch calc(${TOGGLE_SIZE} + 2ch);
  border-top: 0.125em solid;
  background-color: inherit;
}

.${CLASS.overlayPosition} {
  white-space: pre-wrap;
}

.${CLASS.overlayKeyHints} {
  display: flex;
  flex-wrap: wrap;
  gap: 0 3ch;
}

.${CLASS.overlayKeyHint} [aria-hidden],
.${CLASS.overlayKeyHint}[data-disabled],
.${CLASS.overlayKeyHintNote} {
  opacity: 0.6;
}

.${CLASS.overlayKeyHint} button {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
}

.${CLASS.overlayKeyHint} button:enabled:hover {
  text-decoration: underline;
}

.${CLASS.editorChooser},
.${CLASS.overlayNotice} {
  display: grid;
  gap: 1ch;
  min-height: 0;
  overflow-y: auto;
  padding: 2ch;
  border-top: 0.125em solid;
}

.${CLASS.editorChooser} p,
.${CLASS.editorChooser} pre,
.${CLASS.overlayNotice} p,
.${CLASS.overlayNotice} pre {
  margin: 0;
}

.${CLASS.editorChooser} pre {
  padding: 0;
}

.${CLASS.editorChooser} button {
  font: inherit;
  color: inherit;
}

.${CLASS.editorChooser} a {
  color: inherit;
}

.${CLASS.editorChooserOptions} {
  display: flex;
  flex-wrap: wrap;
  gap: 1ch 3ch;
}

.${CLASS.editorChooserOptions} button {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
}

.${CLASS.editorChooserOptions} button:hover {
  text-decoration: underline;
}

.${CLASS.editorChooserOptions} [aria-hidden] {
  opacity: 0.6;
}

.${CLASS.editorChooser} [aria-pressed="true"] {
  font-weight: bold;
}

.${CLASS.overlayKeyHint} button:disabled {
  opacity: 0.6;
  cursor: default;
}

.${CLASS.overlayKeyHint} button:disabled b {
  font-weight: normal;
}

.${CLASS.root} {
  all: initial;
  color-scheme: light dark;
  --fg: CanvasText;
  --bg: Canvas;
  --muted: color-mix(in srgb, var(--fg) 60%, var(--bg));
  --border-thickness: 0.125em;
  --border: 1px solid var(--muted);
  --edge-top: max(env(safe-area-inset-top), var(--gap));
  --edge-bottom: max(env(safe-area-inset-bottom), var(--gap));
  --edge-left: max(env(safe-area-inset-left), var(--gap));
  --edge-right: max(env(safe-area-inset-right), var(--gap));
  --top: calc(var(--edge-top) + var(--y) * (100% - var(--edge-top) - var(--edge-bottom) - ${TOGGLE_SIZE}));
  --gap: 4px;
  position: absolute;
  inset: 0;
  /* The root covers the whole window. Only its children are clickable. */
  pointer-events: none;
  color: var(--fg);
  font-family: var(--monospace);
  /* Like the overlay: The browser’s default font size, so that it can be
     changed in the browser settings. */
  font-size: medium;
  line-height: 1.4;
}

/* Like in the overlay. */
.${CLASS.root} :focus-visible {
  outline: var(--border-thickness) solid currentColor;
  outline-offset: 0.25em;
}

.${CLASS.toggleButton} {
  pointer-events: auto;
  position: absolute;
  top: var(--top);
  left: var(--edge-left);
  display: grid;
  /* Emoji can be wider than the button (Segoe UI Emoji on Windows). A fixed
  column makes them overflow equally on both sides, instead of to the right. */
  grid-template-columns: 100%;
  place-items: center;
  width: ${TOGGLE_SIZE};
  height: ${TOGGLE_SIZE};
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/*
For touch, enlarge the hit area of the emoji button. It grows away from the
corner (or side) of the window the emoji is in, so that the emoji ends up in
the corner of its hit area. The panel may cover parts of it.
*/
@media (pointer: coarse) {
  .${CLASS.toggleButton}::before {
    content: "";
    position: absolute;
    --grow: calc(${TOUCH_SIZE} - ${TOGGLE_SIZE});
    top: calc(var(--grow) / -2);
    bottom: calc(var(--grow) / -2);
    left: 0;
    right: calc(var(--grow) * -1);
  }

  .${CLASS.rootRight} .${CLASS.toggleButton}::before {
    left: calc(var(--grow) * -1);
    right: 0;
  }

  .${CLASS.rootTopEdge} .${CLASS.toggleButton}::before {
    top: 0;
    bottom: calc(var(--grow) * -1);
  }

  .${CLASS.rootBottomEdge} .${CLASS.toggleButton}::before {
    top: calc(var(--grow) * -1);
    bottom: 0;
  }
}

.${CLASS.rootRight} .${CLASS.toggleButton} {
  left: auto;
  right: var(--edge-right);
}

.${CLASS.rootDragging} .${CLASS.toggleButton} {
  cursor: grabbing;
  will-change: transform;
}

.${CLASS.toggleEmoji} {
  position: relative;
  /* Center the emoji vertically regardless of the font’s line metrics.
  Without this, Segoe UI Emoji (Windows) ends up 1.5px too low. */
  text-box: trim-both cap alphabetic;
}

.${CLASS.badge} {
  position: absolute;
  right: -2.5px;
  bottom: -4px;
  /* Like the toggle button: A fixed size box, so that the emoji ends up in the
  same place regardless of the font. Otherwise Segoe UI Emoji (Windows) sticks
  out below the window when the button is at the bottom edge. */
  display: grid;
  grid-template-columns: 100%;
  place-items: center;
  width: 11px;
  height: 11px;
  font-size: 11px;
}

.${CLASS.badge} > span {
  text-box: trim-both cap alphabetic;
}

.${CLASS.flash} {
  position: absolute;
  top: 50%;
  left: 50%;
}

[data-flash]::before {
  content: "";
  position: absolute;
  --size: min(500px, 100vmin);
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  animation: flash 0.7s 0.05s ease-out both;
  pointer-events: none;
}

[data-flash="error"]::before {
  background-color: #eb0000;
}

[data-flash="success"]::before {
  background-color: #00b600;
}

@keyframes flash {
  from {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0.9;
  }

  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}

@keyframes nudge {
  from {
    opacity: 0;
  }

  to {
    opacity: 0.8;
  }
}

@media (prefers-reduced-motion: reduce) {
  [data-flash]::before {
    transform: translate(-50%, -50%);
    width: 2em;
    height: 2em;
    animation: nudge 0.25s ease-in-out 4 alternate forwards;
  }
}

/*
\`position: fixed\` rather than \`absolute\`, since the panel is in the top layer
(as a popover), where \`absolute\` would be relative to the document rather
than the window. \`inset\`, \`margin\`, \`padding\` and \`color\` override the
default popover styles.
*/
.${CLASS.panel} {
  pointer-events: auto;
  position: fixed;
  inset: auto;
  top: calc(var(--top) + ${TOGGLE_SIZE} + var(--gap));
  left: var(--edge-left);
  margin: 0;
  padding: 0;
  color: inherit;
  box-sizing: border-box;
  width: max-content;
  max-width: min(60ch, 100% - var(--edge-left) - var(--edge-right));
  max-height: calc(100% - var(--top) - ${TOGGLE_SIZE} - var(--gap) - var(--edge-bottom));
  /* Only the targets scroll, not the header and footer. */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--bg);
  border: var(--border);
  border-radius: 0;
  /* Stand out a bit more from the page behind. */
  box-shadow: 0 0.125em 0.75em rgb(0 0 0 / 0.25);
  outline: none;
  transition: opacity 0.12s;
}

/* \`display: flex\` above overrides the default popover styles for closed
   popovers. (The \`popover\` attribute is only set if supported.) */
.${CLASS.panel}[popover]:not(:popover-open) {
  display: none;
}

.${CLASS.rootRight} .${CLASS.panel} {
  left: auto;
  right: var(--edge-right);
}

.${CLASS.rootBottomHalf} .${CLASS.panel} {
  top: auto;
  bottom: calc(100% - var(--top) + var(--gap));
  max-height: calc(var(--top) - var(--gap) - var(--edge-top));
}

.${CLASS.rootDragging} .${CLASS.panel} {
  display: none;
}

/*
Not \`display: none\` or \`visibility: hidden\`: When moving with the keyboard,
focus might be inside the panel and must not be lost.
*/
.${CLASS.rootMoving} .${CLASS.panel} {
  opacity: 0;
  transition: none;
}

.${CLASS.header} {
  display: flex;
  align-items: center;
  gap: 2ch;
  padding: 0.5ch 0.5ch 0.5ch 1ch;
  border-bottom: var(--border);
}

.${CLASS.title} {
  flex: 1;
  margin: 0;
  font-size: inherit;
  font-weight: bold;
  white-space: nowrap;
}

.${CLASS.version} {
  color: var(--muted);
  font-weight: normal;
}

/* Like the key hints in the overlay: [Show errors] */
.${CLASS.button} {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
  white-space: nowrap;
}

.${CLASS.button}::before,
.${CLASS.button}::after {
  color: var(--muted);
}

.${CLASS.button}::before {
  content: "[";
}

.${CLASS.button}::after {
  content: "]";
}

.${CLASS.button}:hover {
  text-decoration: underline;
}

.${CLASS.iconButton} {
  appearance: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.${CLASS.iconButton}:hover {
  color: var(--fg);
}

.${CLASS.iconButton}:focus-visible {
  outline-offset: -4px;
}

.${CLASS.targets} {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 0;
  list-style: none;
}

.${CLASS.target} {
  padding: 1ch;
}

.${CLASS.target} + .${CLASS.target} {
  border-top: var(--border);
}

/* The emoji is on the same line as the target name. */
.${CLASS.row} {
  display: flex;
  align-items: baseline;
  gap: 1ch;
}

.${CLASS.rowIcon} {
  width: 2ch;
  text-align: center;
}

.${CLASS.rowText} {
  flex: 1 1 20ch;
  display: grid;
  min-width: 0;
}

.${CLASS.targetName} {
  font-weight: bold;
  overflow-wrap: anywhere;
}

.${CLASS.statusLine} {
  color: var(--muted);
  font-size: 0.8125em;
}

/* Like menus in terminal UIs: The selected mode is in reverse video. */
.${CLASS.modes} {
  justify-self: start;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0 1ch;
  /* Align the text (rather than the padding) of the first mode with the
     text above. */
  margin: 0 0 0 -1ch;
  min-inline-size: 0;
  padding: 0;
  border: none;
}

.${CLASS.modes} label {
  position: relative;
  padding: 0 1ch;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.${CLASS.modes} label:hover {
  color: var(--fg);
  text-decoration: underline;
}

.${CLASS.modes} label:has(:checked) {
  background-color: var(--fg);
  color: var(--bg);
  text-decoration: none;
}

.${CLASS.modes} label:has(:focus-visible) {
  outline: var(--border-thickness) solid var(--fg);
  outline-offset: 0.125em;
}

.${CLASS.modes} label:has(:disabled) {
  cursor: default;
  opacity: 0.5;
}

.${CLASS.modes} label:has(:disabled):hover {
  color: var(--muted);
  text-decoration: none;
}

.${CLASS.modes} label:has(:checked:disabled):hover {
  color: var(--bg);
}

.${CLASS.modes} input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}

.${CLASS.details} {
  display: grid;
  gap: 1ch;
  margin: 1ch 0 0 3ch;
}

/* Smaller than the header and the target names. Set on the children, so that
   the \`ch\` based indentation of the details matches the target names. */
.${CLASS.details} > * {
  font-size: 0.8125em;
}

.${CLASS.note} {
  color: var(--muted);
}

.${CLASS.details} pre {
  margin: 0;
  padding-left: 1ch;
  border-left: var(--border-thickness) solid var(--muted);
  font-family: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.${CLASS.details} a {
  color: inherit;
}

.${CLASS.details} .${CLASS.button} {
  justify-self: start;
}

.${CLASS.footer} {
  margin: 0;
  /* Line up with the header, whose \`ch\` is larger due to the font size. */
  padding: 0.5ch calc(1ch / 0.8125);
  border-top: var(--border);
  color: var(--muted);
  font-size: 0.8125em;
}

.${CLASS.visuallyHidden} {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;

type StatusData = {
  icon: string;
  status: string;
  // Used to pick which status to show for the collapsed UI: The one with the
  // highest number.
  severity: number;
};

export function statusIconAndText(
  snapshot: Pick<
    TargetSnapshot,
    "status" | "elmCompiledTimestamp" | "elmCompiledTimestampBeforeReload"
  >,
): StatusData {
  switch (snapshot.status.tag) {
    case "Busy":
      return {
        icon: "⏳",
        status: "Waiting for compilation",
        severity: 1,
      };

    case "CompileError":
      return {
        icon: "🚨",
        status: "Compilation error",
        severity: 3,
      };

    case "Connecting":
      return {
        icon: "🔌",
        status: "Connecting",
        severity: 2,
      };

    case "TargetError":
      return {
        icon: "🚨",
        status: "elm.json or inputs error",
        severity: 3,
      };

    case "EvalError":
      return {
        icon: "⛔️",
        status: "Eval error",
        severity: 4,
      };

    case "FileProtocol":
      return {
        icon: "🚫",
        status: "Opened via file://",
        severity: 3,
      };

    case "Idle":
      return {
        icon: "✅",
        status: "Successfully compiled",
        severity: 0,
      };

    case "SleepingBeforeReconnect":
      return {
        icon: "🔌",
        status: "Sleeping",
        severity: 2,
      };

    case "UnexpectedError":
      return {
        icon: "❌",
        status: "Unexpected error",
        severity: 5,
      };

    case "WaitingForReload":
      return isReloadTrouble(snapshot)
        ? {
            icon: "❌",
            status: "Reload trouble",
            severity: 5,
          }
        : {
            icon: "⏳",
            status: "Waiting for reload",
            severity: 1,
          };
  }
}

// Statuses with at least this severity count as errors.
const ERROR_SEVERITY = 3;

function isReloadTrouble(
  snapshot: Pick<
    TargetSnapshot,
    "elmCompiledTimestamp" | "elmCompiledTimestampBeforeReload"
  >,
): boolean {
  return (
    snapshot.elmCompiledTimestamp === snapshot.elmCompiledTimestampBeforeReload
  );
}

function externalErrorsStatus(source: string): StatusData {
  return {
    icon: "🚨",
    status: `Errors from ${source}`,
    severity: ERROR_SEVERITY,
  };
}

function worstStatus(
  snapshots: Array<TargetSnapshot>,
  externalSources: Array<string>,
): StatusData | undefined {
  let worst: StatusData | undefined = undefined;
  for (const statusData of [
    ...externalSources.map(externalErrorsStatus),
    ...snapshots.map(statusIconAndText),
  ]) {
    if (worst === undefined || statusData.severity > worst.severity) {
      worst = statusData;
    }
  }
  return worst;
}

function summaryLabel(
  snapshots: Array<TargetSnapshot>,
  externalSources: Array<string>,
): string {
  const targetsLabel = summaryLabelForTargets(snapshots);
  const last = externalSources[externalSources.length - 1];
  const rest = externalSources.slice(0, -1);
  return last === undefined
    ? targetsLabel
    : `${targetsLabel}. ${
        rest.length === 0
          ? `${last} has`
          : `${rest.join(", ")} and ${last} have`
      } errors`;
}

function summaryLabelForTargets(snapshots: Array<TargetSnapshot>): string {
  const statuses = snapshots.map(statusIconAndText);
  const worst = worstStatus(snapshots, []);
  const { length } = statuses;

  if (worst === undefined) {
    return "elm-watch";
  }

  if (length === 1) {
    return `elm-watch: ${worst.status}`;
  }

  const numErrors = statuses.filter(
    (statusData) => statusData.severity >= ERROR_SEVERITY,
  ).length;
  if (numErrors > 0) {
    return `elm-watch: ${numErrors} of ${length} targets ${
      numErrors === 1 ? "has" : "have"
    } errors`;
  }

  const numWorst = statuses.filter(
    (statusData) => statusData.status === worst.status,
  ).length;
  return numWorst === length
    ? `elm-watch: All ${length} targets: ${worst.status}`
    : `elm-watch: ${numWorst} of ${length} targets: ${worst.status}`;
}

function viewPanel({
  snapshots,
  externalErrors,
  hasErrors,
  errorOverlayOpen,
  onToggleErrorOverlay,
  onHide,
  onClose,
  dispatch,
}: {
  snapshots: Array<TargetSnapshot>;
  externalErrors: Array<ExternalErrorsSource>;
  hasErrors: boolean;
  errorOverlayOpen: boolean;
  onToggleErrorOverlay: () => void;
  onHide: (() => void) | undefined;
  onClose: () => void;
  dispatch: (targetName: string, msg: UiMsg) => void;
}): Array<HTMLElement> {
  const version = snapshots[0]?.info.version ?? "";
  const isTouch =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  return [
    h(
      HTMLElement,
      { localName: "header", className: CLASS.header },
      h(
        HTMLHeadingElement,
        { localName: "h2", className: CLASS.title },
        "elm-watch ",
        h(HTMLSpanElement, { className: CLASS.version }, version),
      ),
      hasErrors
        ? h(
            HTMLButtonElement,
            {
              className: CLASS.button,
              attrs: {
                [DATA_FOCUS_KEY]: "errors",
                "data-test-id": errorOverlayOpen
                  ? "HideErrorOverlayButton"
                  : "ShowErrorOverlayButton",
              },
              onclick: onToggleErrorOverlay,
            },
            errorOverlayOpen ? "Hide errors" : "Show errors",
          )
        : onHide === undefined
          ? undefined
          : h(
              HTMLButtonElement,
              {
                className: CLASS.iconButton,
                attrs: {
                  [DATA_FOCUS_KEY]: "hide",
                  "data-test-id": "HideUiButton",
                  "aria-label": "Hide until reload or error",
                  title: "Hide until reload or error",
                },
                onclick: onHide,
              },
              hideIcon(),
            ),
      h(
        HTMLButtonElement,
        {
          className: CLASS.iconButton,
          attrs: {
            [DATA_FOCUS_KEY]: "close",
            "aria-label": "Close elm-watch",
          },
          onclick: onClose,
        },
        closeIcon(),
      ),
    ),
    h(
      HTMLUListElement,
      { className: CLASS.targets },
      ...externalErrors.map(viewExternalErrorsSource),
      ...snapshots.map((snapshot) =>
        viewTarget(
          snapshot,
          isWaitingForOtherTargets(snapshot, snapshots),
          (msg) => {
            dispatch(snapshot.info.targetName, msg);
          },
        ),
      ),
    ),
    h(
      HTMLParagraphElement,
      { className: CLASS.footer },
      isTouch
        ? "Drag emoji to move"
        : "Drag emoji or press shift+arrows to move",
    ),
  ];
}

// Like a target, but with only the number of errors.
function viewExternalErrorsSource({
  source,
  errors,
}: ExternalErrorsSource): HTMLElement {
  return h(
    HTMLLIElement,
    { className: CLASS.target, attrs: { "data-source": source } },
    h(
      HTMLDivElement,
      { className: CLASS.row },
      h(
        HTMLSpanElement,
        { className: CLASS.rowIcon, attrs: { "aria-hidden": "true" } },
        externalErrorsStatus(source).icon,
      ),
      h(
        HTMLSpanElement,
        { className: CLASS.rowText },
        h(HTMLSpanElement, { className: CLASS.targetName }, source),
        h(
          HTMLSpanElement,
          { className: CLASS.statusLine },
          `${errors.size} error${errors.size === 1 ? "" : "s"}`,
        ),
      ),
    ),
  );
}

// The page is only reloaded once no target is `Busy` or `Connecting` (see
// `reloadPageIfNeeded` in client.ts). If no other target is, the reload has
// already been requested, but hasn't happened (yet).
function isWaitingForOtherTargets(
  snapshot: TargetSnapshot,
  snapshots: Array<TargetSnapshot>,
): boolean {
  return snapshots.some(
    (other) =>
      other !== snapshot &&
      (other.status.tag === "Busy" || other.status.tag === "Connecting"),
  );
}

function viewTarget(
  snapshot: TargetSnapshot,
  waitingForOtherTargets: boolean,
  dispatch: (msg: UiMsg) => void,
): HTMLElement {
  const { status, info } = snapshot;
  const statusData = statusIconAndText(snapshot);
  const chooser = viewCompilationModeChooser(snapshot, dispatch);
  const details = [
    ...(chooser.fieldset === undefined ? [] : [chooser.fieldset]),
    ...chooser.details,
    ...viewStatusDetails(snapshot, waitingForOtherTargets, dispatch),
  ];

  return h(
    HTMLLIElement,
    { className: CLASS.target, attrs: { "data-target": info.targetName } },
    h(
      HTMLDivElement,
      { className: CLASS.row },
      h(
        HTMLSpanElement,
        { className: CLASS.rowIcon, attrs: { "aria-hidden": "true" } },
        statusData.icon,
      ),
      h(
        HTMLSpanElement,
        { className: CLASS.rowText },
        h(HTMLSpanElement, { className: CLASS.targetName }, info.targetName),
        h(
          HTMLSpanElement,
          { className: CLASS.statusLine },
          `${statusData.status} · `,
          h(
            HTMLTimeElement,
            { dateTime: status.date.toISOString() },
            formatTime(status.date),
          ),
        ),
      ),
    ),
    details.length === 0
      ? undefined
      : h(HTMLDivElement, { className: CLASS.details }, ...details),
  );
}

function viewStatusDetails(
  snapshot: TargetSnapshot,
  waitingForOtherTargets: boolean,
  dispatch: (msg: UiMsg) => void,
): Array<HTMLElement> {
  const { status, info } = snapshot;
  switch (status.tag) {
    case "Busy":
    case "CompileError":
    case "Idle":
      return [];

    case "Connecting":
      return [
        ...(status.attemptNumber > 1
          ? [h(HTMLParagraphElement, {}, `Attempt ${status.attemptNumber}.`)]
          : []),
        ...viewHttpsInfo(info.webSocketUrl),
      ];

    case "TargetError":
      return [h(HTMLPreElement, {}, status.error)];

    case "EvalError":
      return [
        h(
          HTMLParagraphElement,
          {},
          "Check the console in the browser developer tools to see errors!",
        ),
      ];

    case "FileProtocol": {
      const serverUrl = webSocketUrlToServerUrl(info.webSocketUrl);
      return [
        h(
          HTMLParagraphElement,
          {},
          "elm-watch can’t connect to pages opened via file://, so there is no hot reloading.",
        ),
        h(
          HTMLParagraphElement,
          {},
          "Open the page via a local server instead, for example elm-watch’s: ",
          h(HTMLAnchorElement, { href: serverUrl }, serverUrl),
        ),
      ];
    }

    case "SleepingBeforeReconnect":
      return [
        h(
          HTMLParagraphElement,
          {},
          `Attempt ${status.attemptNumber} failed. Trying again in ${printRetryWaitMs(status.attemptNumber)}.`,
        ),
        ...viewHttpsInfo(info.webSocketUrl),
        h(
          HTMLButtonElement,
          {
            className: CLASS.button,
            attrs: { [DATA_FOCUS_KEY]: `reconnect:${info.targetName}` },
            onclick: () => {
              dispatch({ tag: "PressedReconnectNow" });
            },
          },
          "Reconnect now",
        ),
      ];

    case "UnexpectedError":
      return [
        h(
          HTMLParagraphElement,
          {},
          "I ran into an unexpected error! This is the error message:",
        ),
        h(HTMLPreElement, {}, status.message),
      ];

    case "WaitingForReload":
      return isReloadTrouble(snapshot)
        ? [
            "A while ago I reloaded the page to get new compiled JavaScript.",
            "But it looks like after the last page reload I got the same JavaScript as before, instead of new stuff!",
            `The old JavaScript was compiled ${new Date(
              snapshot.elmCompiledTimestamp,
            ).toLocaleString()}, and so was the JavaScript currently running.`,
            "I currently need to reload the page again, but fear a reload loop if I try.",
            "Do you have accidental HTTP caching enabled maybe?",
            "Try hard refreshing the page and see if that helps, and consider disabling HTTP caching during development.",
          ].map((text) => h(HTMLParagraphElement, {}, text))
        : [
            h(
              HTMLParagraphElement,
              {},
              waitingForOtherTargets
                ? "Waiting for other targets…"
                : "Waiting for page reload…",
            ),
          ];
  }
}

type CompilationModeOption = {
  mode: CompilationMode;
  name: string;
  toggled: Toggled;
};

export type Toggled =
  | {
      tag: "Disabled";
      reason: string;
    }
  | {
      tag: "Enabled";
    };

function viewCompilationModeChooser(
  { status, compilationMode: selectedMode, info, sendKey }: TargetSnapshot,
  dispatch: (msg: UiMsg) => void,
): { fieldset: HTMLElement | undefined; details: Array<HTMLElement> } {
  switch (status.tag) {
    case "Busy":
    case "CompileError":
    case "Idle":
      break;
    default:
      return { fieldset: undefined, details: [] };
  }

  // `Busy` has a special case send key, but switching compilation mode while
  // busy is not supported.
  const modeSendKey = status.tag === "Busy" ? undefined : sendKey;

  const compilationModes: Array<CompilationModeOption> = [
    { mode: "debug", name: "Debug", toggled: info.debugModeToggled },
    { mode: "standard", name: "Standard", toggled: { tag: "Enabled" } },
    { mode: "optimize", name: "Optimize", toggled: { tag: "Enabled" } },
  ];

  const fieldset = h(
    HTMLFieldSetElement,
    { className: CLASS.modes, disabled: modeSendKey === undefined },
    h(
      HTMLLegendElement,
      { className: CLASS.visuallyHidden },
      `Compilation mode for ${info.targetName}`,
    ),
    ...compilationModes.map(({ mode, name, toggled }) =>
      h(
        HTMLLabelElement,
        {
          title: toggled.tag === "Disabled" ? toggled.reason : "",
        },
        h(HTMLInputElement, {
          type: "radio",
          name: `CompilationMode-${info.targetName}`,
          value: mode,
          checked: mode === selectedMode,
          disabled: modeSendKey === undefined || toggled.tag === "Disabled",
          attrs: { [DATA_FOCUS_KEY]: `mode:${info.targetName}:${mode}` },
          onchange:
            modeSendKey === undefined
              ? null
              : () => {
                  dispatch({
                    tag: "ChangedCompilationMode",
                    compilationMode: mode,
                    sendKey: modeSendKey,
                  });
                },
        }),
        name,
      ),
    ),
  );

  const details: Array<HTMLElement> = [];

  if (info.debugModeToggled.tag === "Disabled") {
    details.push(
      h(
        HTMLParagraphElement,
        { className: CLASS.note },
        info.debugModeToggled.reason,
      ),
    );
  }

  if (
    // Avoid the note flashing by when switching modes (which is usually very fast).
    status.tag !== "Busy" &&
    selectedMode !== info.originalCompilationMode &&
    info.originalCompilationMode !== "proxy"
  ) {
    details.push(
      h(
        HTMLParagraphElement,
        { className: CLASS.note },
        `Note: The code currently running is in ${info.originalCompilationMode} mode.`,
      ),
    );
  }

  return { fieldset, details };
}

function viewOpenEditorError(message: string): HTMLElement {
  return h(
    HTMLDivElement,
    { className: CLASS.overlayNotice, attrs: { role: "alert" } },
    h(
      HTMLParagraphElement,
      {},
      h(
        HTMLElement,
        { localName: "strong" },
        "Opening the location in your editor failed!",
      ),
    ),
    h(HTMLPreElement, {}, message),
  );
}

// elm-watch’s HTTP server is on the same host and port as its WebSocket.
function webSocketUrlToServerUrl(webSocketUrl: URL): string {
  const url = new URL(webSocketUrl);
  url.protocol = webSocketUrl.protocol === "wss:" ? "https:" : "http:";
  return url.origin;
}

function viewHttpsInfo(webSocketUrl: URL): Array<HTMLElement> {
  return webSocketUrl.protocol === "wss:"
    ? [
        h(
          HTMLParagraphElement,
          {},
          h(HTMLElement, { localName: "strong" }, "Having trouble connecting?"),
        ),
        h(HTMLParagraphElement, {}, "Setting up HTTPS can be a bit tricky."),
        h(
          HTMLParagraphElement,
          {},
          "Read all about ",
          h(
            HTMLAnchorElement,
            {
              href: "https://lydell.github.io/elm-watch/https/",
              target: "_blank",
              rel: "noreferrer",
            },
            "HTTPS with elm-watch",
          ),
          ".",
        ),
      ]
    : [];
}

// One error from one or more targets. Opening the editor goes via the first
// target that has the error.
type OverlayErrorItem = {
  id: string;
  location: ErrorLocation | undefined;
  error: OverlayError;
  sendKey: SendKey | undefined;
  dispatch: (msg: UiMsg) => void;
};

type OverlayKey =
  | NavigationKey
  | "CancelEditorChooser"
  | "ChangeEditor"
  | "CloseOverlay"
  | "OpenEditor"
  | "ToggleExpanded"
  | "ToggleShowAll";

// Like in the terminal, minus tab for switching target: In the browser, the
// errors of all targets on the page are shown together.
function overlayKeyFromEvent(event: KeyboardEvent): OverlayKey | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return undefined;
  }
  switch (event.key) {
    case "ArrowRight":
    case "l":
      return "NextError";
    case "ArrowLeft":
    case "h":
      return "PreviousError";
    case "ArrowDown":
    case "j":
      return "NextFile";
    case "ArrowUp":
    case "k":
      return "PreviousFile";
    case "Enter":
    case "o":
      return "OpenEditor";
    case "e":
      return "ChangeEditor";
    case " ":
      return "ToggleExpanded";
    case "a":
      return "ToggleShowAll";
    default:
      return undefined;
  }
}

type LocationToOpen = {
  file: AbsolutePath;
  line: number;
  column: number;
};

// Only while connected, like the other actions.
function getOverlayOpenEditorLocation(
  item: OverlayErrorItem | undefined,
): LocationToOpen | undefined {
  return item?.sendKey === undefined
    ? undefined
    : getOpenEditorLocation(item.location);
}

// “e” is only offered if some shown error location can be opened, and an editor
// has already been chosen. Otherwise, opening a location shows the chooser
// anyway.
function canChangeEditor(
  items: Array<OverlayErrorItem>,
  editor: Pick<OverlayEditor, "current" | "envSet">,
): boolean {
  return (
    (editor.current !== undefined || editor.envSet) &&
    items.some((item) => getOverlayOpenEditorLocation(item) !== undefined)
  );
}

// For screen readers: Which error is shown, or how many errors there are when
// showing all of them.
function getOverlayAnnouncement(
  group: ErrorGroup<OverlayErrorItem>,
  selection: Selection | undefined,
): string {
  if (group.numErrors === 0) {
    return "";
  }
  if (selection === undefined) {
    return `${group.numErrors} error${group.numErrors === 1 ? "" : "s"}`;
  }
  const item = getSelectedError(selection, [group]);
  return item === undefined
    ? ""
    : `Error ${getErrorNumber(selection, group)} of ${group.numErrors}: ${item.error.title}`;
}

function viewOverlay({
  group,
  selection,
  showAll,
  expanded,
  onKey,
  onOpenEditor,
  editor,
  openEditorError,
}: {
  group: ErrorGroup<OverlayErrorItem>;
  selection: Selection | undefined;
  showAll: boolean;
  expanded: boolean;
  onKey: (key: OverlayKey) => void;
  onOpenEditor: (item: OverlayErrorItem, location: LocationToOpen) => void;
  editor: OverlayEditor;
  openEditorError: string | undefined;
}): Array<HTMLElement> {
  if (group.numErrors === 0) {
    return [];
  }

  // While choosing an editor, the other keys are paused.
  const aboveFooter = [
    openEditorError === undefined
      ? undefined
      : viewOpenEditorError(openEditorError),
    editor.chooser === undefined
      ? undefined
      : viewEditorChooser(editor.chooser),
  ];
  const cancelHints: Array<OverlayHint> = [
    [[["esc", "CancelEditorChooser", true, "Cancel"]], "cancel"],
  ];
  const closeHint: OverlayHint = [
    [["esc", "CloseOverlay", true, "Close error overlay"]],
    "close",
    "(again to reopen)",
  ];

  if (showAll || selection === undefined) {
    const items = group.files.flatMap((file) => file.errors);
    return [
      ...items.map((item) => viewOverlayError(item, true, onKey, onOpenEditor)),
      viewOverlayFooter(
        aboveFooter,
        `🚨 ${items.length} error${items.length === 1 ? "" : "s"}`,
        editor.chooser === undefined
          ? [
              canChangeEditor(items, editor)
                ? [
                    [["e", "ChangeEditor", true, "Change editor"]],
                    "change editor",
                  ]
                : undefined,
              [
                [["a", "ToggleShowAll", true, "Show one error at a time"]],
                "show one error at a time",
              ],
              closeHint,
            ]
          : cancelHints,
        onKey,
      ),
    ];
  }

  const item = getSelectedError(selection, [group]);
  if (item === undefined) {
    return [];
  }
  const errorNumber = getErrorNumber(selection, group);
  const position = [
    `error ${errorNumber}/${group.numErrors}`,
    group.files.length > 1
      ? `file ${selection.fileIndex + 1}/${group.files.length}`
      : undefined,
  ]
    .flatMap((part) => part ?? [])
    .join("   ");

  const canOpenEditor = getOverlayOpenEditorLocation(item) !== undefined;
  const openInName = editor.current?.name ?? "editor";

  return [
    viewOverlayError(item, expanded, onKey, onOpenEditor),
    viewOverlayFooter(
      aboveFooter,
      `🚨 ${position}`,
      editor.chooser !== undefined
        ? cancelHints
        : [
            [
              [
                ["←", "PreviousError", errorNumber > 1, "Previous error"],
                ["→", "NextError", errorNumber < group.numErrors, "Next error"],
              ],
              "error",
            ],
            [
              [
                ["↑", "PreviousFile", selection.fileIndex > 0, "Previous file"],
                [
                  "↓",
                  "NextFile",
                  selection.fileIndex + 1 < group.files.length,
                  "Next file",
                ],
              ],
              "file",
            ],
            canOpenEditor
              ? [
                  [["enter", "OpenEditor", true, `Open in ${openInName}`]],
                  `open in ${openInName}`,
                ]
              : undefined,
            canChangeEditor([item], editor)
              ? [
                  [["e", "ChangeEditor", true, "Change editor"]],
                  "change editor",
                ]
              : undefined,
            item.error.htmlContentCollapsed === undefined
              ? undefined
              : [
                  [
                    [
                      "space",
                      "ToggleExpanded",
                      true,
                      expanded ? "Collapse long code" : "Expand long code",
                    ],
                  ],
                  expanded ? "collapse" : "expand",
                ],
            [[["a", "ToggleShowAll", true, "Show all errors"]], "show all"],
            closeHint,
          ],
      onKey,
    ),
  ];
}

// Shown in the error overlay when clicking an error location without having
// chosen an editor (and the server doesn’t open the editor), or when pressing
// “e” to change editor.
function viewEditorChooser({
  location,
  showOther,
  current,
  envSet,
  onChoose,
  onShowOther,
}: EditorChooserProps): HTMLElement {
  const otherNumber = (EDITOR_PRESETS.length + 1).toString();
  return h(
    HTMLDivElement,
    {
      className: CLASS.editorChooser,
      attrs: { role: "group", "aria-label": "Choose editor" },
    },
    h(
      HTMLParagraphElement,
      {},
      location === undefined
        ? "Open error locations in:"
        : "Which editor should I open this in?",
    ),
    h(
      HTMLParagraphElement,
      { className: CLASS.editorChooserOptions },
      ...EDITOR_PRESETS.map((preset, index) =>
        h(
          HTMLButtonElement,
          {
            attrs: {
              [DATA_FOCUS_KEY]: `editor:${preset.id}`,
              "aria-keyshortcuts": (index + 1).toString(),
              "aria-pressed": (current?.id === preset.id).toString(),
            },
            onclick: () => {
              onChoose(preset.id);
            },
          },
          h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "["),
          h(HTMLElement, { localName: "b" }, (index + 1).toString()),
          h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "]"),
          ` ${preset.name}`,
        ),
      ),
      h(
        HTMLButtonElement,
        {
          attrs: {
            [DATA_FOCUS_KEY]: "editorOther",
            "aria-keyshortcuts": otherNumber,
            // When set, the environment variable is used unless a preset has
            // been chosen.
            ...(envSet
              ? { "aria-pressed": (current === undefined).toString() }
              : {}),
          },
          onclick: envSet
            ? () => {
                onChoose(null);
              }
            : onShowOther,
        },
        h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "["),
        h(HTMLElement, { localName: "b" }, otherNumber),
        h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "]"),
        envSet ? " ELM_WATCH_OPEN_EDITOR" : " Other",
      ),
    ),
    ...(showOther ? viewOtherEditor() : []),
  );
}

// Other editors are set up with an environment variable rather than in the
// browser, so they survive deleting elm-stuff/.
function viewOtherEditor(): Array<HTMLElement> {
  return [
    h(
      HTMLParagraphElement,
      {},
      "To use another editor, set the ELM_WATCH_OPEN_EDITOR environment variable. The easiest way to get started is to run:",
    ),
    h(HTMLPreElement, {}, "elm-watch editor"),
  ];
}

function viewOverlayError(
  item: OverlayErrorItem,
  expanded: boolean,
  onKey: (key: OverlayKey) => void,
  onOpenEditor: (item: OverlayErrorItem, location: LocationToOpen) => void,
): HTMLElement {
  const { error } = item;
  return h(
    HTMLDivElement,
    {
      className: CLASS.overlayError,
      style: {
        backgroundColor: error.backgroundColor,
        color: error.foregroundColor,
      },
    },
    h(
      HTMLDivElement,
      { className: CLASS.overlayErrorHeader },
      h(
        HTMLSpanElement,
        {
          className: CLASS.errorTitle,
          style: {
            backgroundColor: error.backgroundColor,
          },
        },
        error.title,
      ),
      error.location === undefined
        ? undefined
        : h(HTMLSpanElement, { className: CLASS.errorTitleSpacer }),
      error.location === undefined
        ? undefined
        : h(
            HTMLSpanElement,
            {
              className: CLASS.errorTitleLocation,
              style: {
                backgroundColor: error.backgroundColor,
              },
            },
            viewErrorLocation(
              item.sendKey !== undefined,
              error.location,
              (location) => {
                onOpenEditor(item, location);
              },
            ),
          ),
    ),
    h(HTMLPreElement, {
      innerHTML: expanded
        ? error.htmlContent
        : (error.htmlContentCollapsed ?? error.htmlContent),
      // The “(N lines)” buttons in collapsed code excerpts.
      onclick: (event: MouseEvent) => {
        if (
          event.target instanceof Element &&
          event.target.closest("[data-expand]") !== null
        ) {
          onKey("ToggleExpanded");
        }
      },
    }),
  );
}

// Key, which key it acts as, whether it does anything right now, and a label
// for screen readers.
type OverlayHintKey = [
  key: string,
  overlayKey: OverlayKey,
  enabled: boolean,
  label: string,
];

// Keys, label, and an optional dimmed note after the label.
type OverlayHint = [keys: Array<OverlayHintKey>, label: string, note?: string];

// Styled like in the terminal: [key] label
// The hints are buttons, so that they work with the mouse and on touch screens.
// A hint with a single key is one button, label included. A hint with several
// keys (the arrows) has one button per key, and the label is just text.
// The editor chooser (if open) goes above the footer, sticking with it.
function viewOverlayFooter(
  aboveFooter: Array<HTMLElement | undefined>,
  position: string,
  hints: Array<OverlayHint | undefined>,
  onKey: (key: OverlayKey) => void,
): HTMLElement {
  const footer = h(
    HTMLDivElement,
    { className: CLASS.overlayFooter },
    h(HTMLParagraphElement, { className: CLASS.overlayPosition }, position),
    h(
      HTMLParagraphElement,
      { className: CLASS.overlayKeyHints },
      ...hints.flatMap((hint) => {
        if (hint === undefined) {
          return [];
        }
        const [keys, label, note] = hint;
        const anyEnabled = keys.some(([, , enabled]) => enabled);
        const bracket = (text: string): HTMLElement =>
          h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, text);
        const viewButton = (
          [, overlayKey, enabled, buttonLabel]: OverlayHintKey,
          ...children: Array<HTMLElement | string | undefined>
        ): HTMLButtonElement =>
          h(
            HTMLButtonElement,
            {
              disabled: !enabled,
              attrs: {
                "aria-label": buttonLabel,
                [DATA_FOCUS_KEY]: overlayKey,
              },
              onclick: () => {
                onKey(overlayKey);
              },
            },
            ...children,
          );
        const bold = (key: string): HTMLElement =>
          h(HTMLElement, { localName: "b" }, key);
        const labelAndNote = [
          ` ${label}`,
          note === undefined
            ? undefined
            : h(
                HTMLSpanElement,
                { className: CLASS.overlayKeyHintNote },
                ` ${note}`,
              ),
        ];
        const [singleKey] = keys;
        return [
          h(
            HTMLSpanElement,
            {
              className: CLASS.overlayKeyHint,
              attrs: anyEnabled ? {} : { "data-disabled": "" },
            },
            ...(keys.length === 1 && singleKey !== undefined
              ? [
                  viewButton(
                    singleKey,
                    bracket("["),
                    bold(singleKey[0]),
                    bracket("]"),
                    ...labelAndNote,
                  ),
                ]
              : [
                  bracket("["),
                  ...keys.map((hintKey) =>
                    viewButton(hintKey, bold(hintKey[0])),
                  ),
                  bracket("]"),
                  ...labelAndNote,
                ]),
          ),
        ];
      }),
    ),
  );
  return h(
    HTMLDivElement,
    { className: CLASS.overlayBottom },
    ...aboveFooter,
    footer,
  );
}

function viewErrorLocation(
  clickable: boolean,
  location: ErrorLocation,
  onOpenEditor: (location: LocationToOpen) => void,
): HTMLElement {
  switch (location.tag) {
    case "FileOnly":
      return viewErrorLocationButton(
        clickable,
        { file: location.file, line: 1, column: 1 },
        [location.relativeFile],
        onOpenEditor,
      );

    case "FileWithLineAndColumn": {
      return viewErrorLocationButton(
        clickable,
        location,
        [
          location.relativeFile,
          h(
            HTMLSpanElement,
            { className: CLASS.dim },
            `:${location.line}:${location.column}`,
          ),
        ],
        onOpenEditor,
      );
    }

    case "Target":
      return h(
        HTMLSpanElement,
        { className: CLASS.dim },
        `Target: ${location.targetName}`,
      );
  }
}

function viewErrorLocationButton(
  clickable: boolean,
  location: LocationToOpen,
  children: Array<Node | string>,
  onOpenEditor: (location: LocationToOpen) => void,
): HTMLElement {
  return clickable
    ? h(
        HTMLButtonElement,
        {
          className: CLASS.errorLocationButton,
          onclick: () => {
            onOpenEditor({
              file: location.file,
              line: location.line,
              column: location.column,
            });
          },
        },
        ...children,
      )
    : h(HTMLSpanElement, {}, ...children);
}
