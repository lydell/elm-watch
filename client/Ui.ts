import * as Codec from "tiny-decoders";

import {
  EDITOR_PLACEHOLDERS,
  EDITOR_PRESETS,
  EDITOR_URL_EXAMPLE,
  type Editor,
  editorUrl,
  parseEditor,
  validateEditorUrlTemplate,
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
import type {
  ErrorLocation,
  OpenEditorError,
  OpenEditorSetup,
} from "./WebSocketMessages.ts";

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

export type OpenEditorSetupWithHint = {
  setup: OpenEditorSetup;
  commandHint: string | null;
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
      openEditorError: OpenEditorError | undefined;
    }
  | {
      tag: "Connecting";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "ElmJsonError";
      date: Date;
      error: string;
    }
  | {
      tag: "EvalError";
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
// `UI_VERSION` whenever `Ui` or anything it uses changes (such as
// `TargetSnapshot`). Targets with a different UI version get a UI of their own.
export const UI_VERSION = 1;

// Documented, for hiding the UI with CSS, so it does not change with
// `UI_VERSION`. Several UIs (from different versions) get the same ID, which is
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
  unregister: () => void;
};

export type UiTargetCallbacks = {
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
  openEditor: OpenEditorSetupWithHint | undefined;
};

type OverlayErrorsEntry = {
  errors: Map<string, OverlayError>;
  sendKey: SendKey | undefined;
  dispatch: (msg: UiMsg) => void;
};

type EditorChooser = {
  // The error location to open once an editor has been chosen.
  location: LocationToOpen | undefined;
  // Whether “Other” has been chosen, showing the URL field and how to run a
  // command instead.
  showOther: boolean;
  // Kept here, since the panel is re-created on every render.
  customTemplate: string;
  customError: string | undefined;
};

type EditorChooserProps = EditorChooser & {
  current: Editor | undefined;
  commandHint: string | null;
  onChoose: (editor: string) => void;
  onShowOther: () => void;
  onCustomInput: (value: string) => void;
  onCustomSubmit: () => void;
  onUseExample: () => void;
};

type OverlayEditor = {
  // The editor chosen in the browser, if any.
  current: Editor | undefined;
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
  const dialog = h(
    typeof HTMLDialogElement === "function"
      ? HTMLDialogElement
      : (HTMLDivElement as typeof HTMLDialogElement),
    { className: CLASS.dialog },
  );

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

  const overlay = h(HTMLDivElement, {
    className: CLASS.overlay,
    attrs: { "data-test-id": "Overlay" },
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

  const overlayCloseBar = h(
    HTMLDivElement,
    { className: CLASS.overlayCloseBar, hidden: true },
    h(
      HTMLSpanElement,
      { className: CLASS.overlayHint, attrs: { "aria-hidden": "true" } },
      "Esc closes · press again to reopen",
    ),
    h(
      HTMLButtonElement,
      {
        className: CLASS.overlayCloseButton,
        attrs: {
          "aria-label": "Close error overlay",
          "aria-keyshortcuts": "Escape",
          "data-test-id": "OverlayCloseButton",
        },
        onclick: closeErrorOverlay,
      },
      closeIcon(),
    ),
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

  for (const element of [overlay, overlayAnnouncement, overlayCloseBar, root]) {
    element.lang = "en";
    element.setAttribute("translate", "no");
  }

  topLayer.append(overlay, overlayAnnouncement, overlayCloseBar, root);
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
      overlayCloseBar.style.setProperty(
        "--foregroundColor",
        firstError.foregroundColor,
      );
      overlayCloseBar.style.setProperty(
        "--backgroundColor",
        firstError.backgroundColor,
      );
    }

    // Restore focus after re-creating the key hint buttons, so that keyboard
    // users don’t lose their place.
    const focusKey =
      shadowRoot.activeElement?.getAttribute(DATA_FOCUS_KEY) ?? undefined;
    const { scrollTop } = overlay;
    // The error ID is JSON, so it can’t be confused with "show all".
    const renderedKey = overlayShowAll ? "show all" : selectedError?.id;

    overlay.replaceChildren(
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

    if (focusKey !== undefined) {
      const element = overlay.querySelector(
        `[${DATA_FOCUS_KEY}="${focusKey}"]`,
      );
      if (element instanceof HTMLElement && !element.matches(":disabled")) {
        element.focus({ preventScroll: true });
      }
    }
  };

  // Space scrolls as usual if there is nothing to collapse.
  const canToggleExpanded = (): boolean =>
    !overlayShowAll &&
    overlaySelection !== undefined &&
    getSelectedError(overlaySelection, [getErrorGroup()])?.error
      .htmlContentCollapsed !== undefined;

  const handleOverlayKey = (key: OverlayKey): void => {
    // The other keys are paused while choosing an editor.
    if (editorChooser !== undefined) {
      if (key === "CancelEditorChooser") {
        closeEditorChooser();
      }
      return;
    }
    switch (key) {
      case "ChangeEditor":
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
        openEditor: OpenEditorSetupWithHint;
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

  const openEditorForItem = (
    item: OverlayErrorItem,
    location: LocationToOpen,
  ): void => {
    const setup = getOpenEditor()?.openEditor.setup;
    switch (setup?.tag) {
      case "Url": {
        const editor = parseEditor(setup.editor);
        if (editor !== undefined) {
          openUrl(editorUrl(editor, location));
        }
        return;
      }

      case "NotSet":
        openEditorChooser(location);
        return;

      case "Server":
      case undefined:
        if (item.sendKey !== undefined) {
          item.dispatch({
            tag: "PressedOpenEditor",
            file: location.file,
            line: location.line,
            column: location.column,
            sendKey: item.sendKey,
          });
        }
        return;
    }
  };

  const canChooseEditor = (): boolean => {
    const result = getOpenEditor();
    return (
      result?.connectedTarget !== undefined &&
      result.openEditor.setup.tag !== "Server"
    );
  };

  const openEditorChooser = (location: LocationToOpen | undefined): void => {
    if (!canChooseEditor()) {
      return;
    }
    const setup = getOpenEditor()?.openEditor.setup;
    const current =
      setup?.tag === "Url" ? parseEditor(setup.editor) : undefined;
    editorChooser = {
      location,
      showOther: current?.tag === "Custom",
      customTemplate: current?.tag === "Custom" ? current.template : "",
      customError: undefined,
    };
    renderOverlay();
    const element = overlay.querySelector(
      current?.tag === "Custom"
        ? `[${DATA_FOCUS_KEY}="editorCustom"]`
        : `[${DATA_FOCUS_KEY}="editor:${current?.tag === "Preset" ? current.preset.id : (EDITOR_PRESETS[0]?.id ?? "")}"]`,
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
    const input = overlay.querySelector(`[${DATA_FOCUS_KEY}="editorCustom"]`);
    if (input instanceof HTMLElement) {
      input.focus();
    }
  };

  const closeEditorChooser = (): void => {
    editorChooser = undefined;
    renderOverlay();
  };

  const chooseEditor = (editorString: string): void => {
    const connectedTarget = getOpenEditor()?.connectedTarget;
    const editor = parseEditor(editorString);
    if (connectedTarget === undefined || editor === undefined) {
      return;
    }
    const location = editorChooser?.location;
    editorChooser = undefined;
    if (location !== undefined) {
      openUrl(editorUrl(editor, location));
    }
    dispatchToTarget(connectedTarget.targetName, {
      tag: "ChoseEditor",
      editor: editorString,
      sendKey: connectedTarget.sendKey,
    });
    renderOverlay();
  };

  const getOverlayEditor = (): OverlayEditor => {
    const result = getOpenEditor();
    const setup = result?.openEditor.setup;
    const current =
      setup?.tag === "Url" ? parseEditor(setup.editor) : undefined;
    return {
      current,
      chooser:
        editorChooser === undefined || result === undefined
          ? undefined
          : {
              ...editorChooser,
              current,
              commandHint: result.openEditor.commandHint,
              onChoose: chooseEditor,
              onShowOther: showOtherEditor,
              onCustomInput: (value) => {
                if (editorChooser !== undefined) {
                  editorChooser.customTemplate = value;
                }
              },
              onCustomSubmit: () => {
                if (editorChooser === undefined) {
                  return;
                }
                const template = editorChooser.customTemplate.trim();
                const error = validateEditorUrlTemplate(template);
                if (error === undefined) {
                  chooseEditor(template);
                } else {
                  editorChooser.customError = error;
                  renderOverlay();
                }
              },
              onUseExample: () => {
                if (editorChooser === undefined) {
                  return;
                }
                editorChooser.customTemplate = EDITOR_URL_EXAMPLE;
                editorChooser.customError = undefined;
                renderOverlay();
                const input = overlay.querySelector(
                  `[${DATA_FOCUS_KEY}="editorCustom"]`,
                );
                if (input instanceof HTMLInputElement) {
                  input.focus();
                  // Select the scheme, which is the part to change.
                  input.setSelectionRange(0, input.value.indexOf(":"));
                }
              },
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
    overlayCloseBar.hidden = hidden;

    // Avoid drawing the close button on top of a scrollbar.
    overlayCloseBar.style.right = `${
      overlay.offsetWidth - overlay.clientWidth
    }px`;

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
      }
    }

    moveToTopLayer(dialog, topLayer);
  };

  const setErrorOverlayOpen = (open: boolean): void => {
    if (open === errorOverlayOpen) {
      return;
    }
    errorOverlayOpen = open;
    if (!open && editorChooser !== undefined) {
      editorChooser = undefined;
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
      if (preset === undefined) {
        showOtherEditor();
      } else {
        chooseEditor(preset.id);
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
  // `.showPopover()` shipped in Firefox 125, released 2024-04-16.
  // At the time of writing (2024-10-27) that was a bit too recent to be
  // required, so we use only call the methods if they exist. The element falls
  // back to having the highest z-index.
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
  editorChooser: "editorChooser",
  editorChooserOptions: "editorChooserOptions",
  editorCustom: "editorCustom",
  editorExample: "editorExample",
  editorNote: "editorNote",
  envNotSet: "envNotSet",
  errorLocationButton: "errorLocationButton",
  errorTitle: "errorTitle",
  flash: "flash",
  footer: "footer",
  header: "header",
  modes: "modes",
  note: "note",
  overlay: "overlay",
  overlayCloseBar: "overlayCloseBar",
  overlayCloseButton: "overlayCloseButton",
  overlayBottom: "overlayBottom",
  overlayError: "overlayError",
  overlayErrorHeader: "overlayErrorHeader",
  overlayFooter: "overlayFooter",
  overlayHint: "overlayHint",
  overlayKeyHint: "overlayKeyHint",
  overlayKeyHints: "overlayKeyHints",
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
  /* Room for the close button above the first error. */
  padding-top: calc(${OVERLAY_CLOSE_BUTTON_SIZE} - 2ch);
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

.${CLASS.overlayCloseBar} {
  position: fixed;
  z-index: -1;
  top: 0;
  right: 0;
  display: flex;
  align-items: center;
  pointer-events: auto;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: var(--foregroundColor);
}

.${CLASS.overlayHint} {
  opacity: 0.7;
  filter: drop-shadow(0 0 0.125em var(--backgroundColor));
}

@media (hover: none) {
  .${CLASS.overlayHint} {
    display: none;
  }
}

.${CLASS.overlayCloseButton} {
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

.${CLASS.overlayCloseButton} svg {
  width: 20px;
  height: 20px;
}

.${CLASS.overlay},
.${CLASS.overlay} pre {
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
}

.${CLASS.overlayError} {
  --border-thickness: 0.125em;
  border-top: var(--border-thickness) solid;
  margin: 2ch 0;
}

.${CLASS.overlayErrorHeader} {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 2ch;
  word-break: break-word;
}

.${CLASS.errorTitle} {
  display: inline-block;
  font-weight: bold;
  --padding: 1ch;
  padding: 0 var(--padding);
  transform: translate(calc(var(--padding) * -1), calc(-50% - var(--border-thickness) / 2));
}

.${CLASS.errorLocationButton} {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
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

.${CLASS.overlayKeyHint} > [aria-hidden],
.${CLASS.overlayKeyHint}[data-disabled] {
  opacity: 0.6;
}

.${CLASS.overlayKeyHint} button {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  font-weight: bold;
  cursor: pointer;
}

.${CLASS.editorChooser} {
  display: grid;
  gap: 1ch;
  min-height: 0;
  overflow-y: auto;
  padding: 2ch;
  border-top: 0.125em solid;
}

.${CLASS.editorChooser} p,
.${CLASS.editorChooser} pre {
  margin: 0;
}

.${CLASS.editorChooser} pre {
  padding: 0;
}

.${CLASS.editorChooser} button,
.${CLASS.editorChooser} input {
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

.${CLASS.editorChooserOptions} button,
.${CLASS.editorCustom} button {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
}

.${CLASS.editorChooserOptions} button:hover,
.${CLASS.editorCustom} button:hover,
.${CLASS.editorExample}:hover {
  text-decoration: underline;
}

.${CLASS.editorChooserOptions} [aria-hidden] {
  opacity: 0.6;
}

.${CLASS.editorChooser} [aria-pressed="true"] {
  font-weight: bold;
}

.${CLASS.editorCustom} {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1ch;
}

.${CLASS.editorCustom} label {
  flex: 1 1 40ch;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1ch;
}

.${CLASS.editorCustom} input {
  flex: 1 1 30ch;
  min-width: 0;
  padding: 0.25ch 1ch;
  border: 1px solid;
  border-radius: 0;
  background: none;
}

.${CLASS.editorCustom} input[aria-invalid="true"] {
  border-style: dashed;
}

.${CLASS.editorCustom} button::before {
  content: "[";
  opacity: 0.6;
}

.${CLASS.editorCustom} button::after {
  content: "]";
  opacity: 0.6;
}

.${CLASS.editorNote} {
  opacity: 0.7;
}

.${CLASS.editorExample} {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  word-break: break-all;
  cursor: pointer;
}

.${CLASS.overlayKeyHint} button:disabled {
  font-weight: normal;
  opacity: 0.6;
  cursor: default;
}

.${CLASS.root} {
  all: initial;
  color-scheme: light dark;
  --muted: color-mix(in srgb, CanvasText 62%, Canvas);
  --border: color-mix(in srgb, CanvasText 18%, Canvas);
  --border-strong: color-mix(in srgb, CanvasText 45%, Canvas);
  --subtle: color-mix(in srgb, CanvasText 6%, Canvas);
  --hover: color-mix(in srgb, CanvasText 11%, Canvas);
  --focus: light-dark(#0b57d0, #a8c7fa);
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
  color: CanvasText;
  font: 13px/1.4 system-ui, sans-serif;
}

.${CLASS.root} :focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
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
  max-width: min(30rem, 100% - var(--edge-left) - var(--edge-right));
  max-height: calc(100% - var(--top) - ${TOGGLE_SIZE} - var(--gap) - var(--edge-bottom));
  overflow: auto;
  overscroll-behavior: contain;
  background-color: Canvas;
  border: 1px solid var(--border);
  border-radius: 10px;
  outline: none;
  transition: opacity 0.12s;
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
  gap: 8px;
  padding: 6px 6px 6px 12px;
  border-bottom: 1px solid var(--border);
}

.${CLASS.title} {
  flex: 1;
  margin: 0;
  font-size: inherit;
  font-weight: 600;
  white-space: nowrap;
}

.${CLASS.version} {
  color: var(--muted);
  font-weight: normal;
  font-variant-numeric: tabular-nums;
}

.${CLASS.button} {
  appearance: none;
  padding: 3px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background-color: var(--subtle);
  cursor: pointer;
  white-space: nowrap;
}

.${CLASS.button}:hover {
  background-color: var(--hover);
}

.${CLASS.iconButton} {
  appearance: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.${CLASS.iconButton}:hover {
  background-color: var(--hover);
  color: CanvasText;
}

.${CLASS.targets} {
  margin: 0;
  padding: 0;
  list-style: none;
}

.${CLASS.target} {
  padding: 10px 12px;
}

.${CLASS.target} + .${CLASS.target} {
  border-top: 1px solid var(--border);
}

.${CLASS.row} {
  display: flex;
  align-items: center;
  gap: 10px;
}

.${CLASS.rowIcon} {
  width: 20px;
  font-size: 16px;
  text-align: center;
}

.${CLASS.rowText} {
  flex: 1 1 10em;
  display: grid;
  min-width: 0;
}

.${CLASS.targetName} {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.${CLASS.statusLine} {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.${CLASS.modes} {
  justify-self: start;
  display: inline-flex;
  gap: 2px;
  margin: 0;
  min-inline-size: 0;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 7px;
}

.${CLASS.modes} label {
  position: relative;
  padding: 2px 8px;
  border-radius: 5px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.${CLASS.modes} label:hover {
  color: CanvasText;
}

.${CLASS.modes} label:has(:checked) {
  color: CanvasText;
  background-color: var(--subtle);
  outline: 1px solid var(--border-strong);
}

.${CLASS.modes} label:has(:focus-visible) {
  outline: 2px solid var(--focus);
}

.${CLASS.modes} label:has(:disabled) {
  cursor: default;
  opacity: 0.5;
}

.${CLASS.modes} label:has(:disabled):hover {
  color: var(--muted);
}

.${CLASS.modes} label:has(:checked:disabled):hover {
  color: CanvasText;
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
  gap: 6px;
  margin: 6px 0 0 30px;
}

.${CLASS.note} {
  color: var(--muted);
  font-size: 12px;
}

.${CLASS.details} pre {
  margin: 0;
  padding-left: 8px;
  border-left: 3px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.${CLASS.details} a {
  color: inherit;
}

.${CLASS.details} .${CLASS.button} {
  justify-self: start;
}

.${CLASS.envNotSet} {
  display: grid;
  gap: 6px;
}


.${CLASS.footer} {
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 12px;
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

    case "ElmJsonError":
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
    case "Idle":
      return [];

    case "CompileError":
      return status.openEditorError === undefined
        ? []
        : viewOpenEditorError(status.openEditorError);

    case "Connecting":
      return [
        ...(status.attemptNumber > 1
          ? [h(HTMLParagraphElement, {}, `Attempt ${status.attemptNumber}.`)]
          : []),
        ...viewHttpsInfo(info.webSocketUrl),
      ];

    case "ElmJsonError":
      return [h(HTMLPreElement, {}, status.error)];

    case "EvalError":
      return [
        h(
          HTMLParagraphElement,
          {},
          "Check the console in the browser developer tools to see errors!",
        ),
      ];

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

function viewOpenEditorError(error: OpenEditorError): Array<HTMLElement> {
  switch (error.tag) {
    case "EnvNotSet":
      return [
        h(
          HTMLDivElement,
          { className: CLASS.envNotSet },
          h(
            HTMLParagraphElement,
            {},
            "ℹ️ Clicking error locations only works if you set it up.",
          ),
          h(
            HTMLParagraphElement,
            {},
            "Check this out: ",
            h(
              HTMLAnchorElement,
              {
                href: "https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations",
                target: "_blank",
                rel: "noreferrer",
              },
              h(
                HTMLElement,
                { localName: "strong" },
                "Clickable error locations",
              ),
            ),
          ),
        ),
      ];

    case "InvalidFilePath":
    case "CommandFailed":
      return [
        h(
          HTMLParagraphElement,
          {},
          h(
            HTMLElement,
            { localName: "strong" },
            "Opening the location in your editor failed!",
          ),
        ),
        h(HTMLPreElement, {}, error.message),
      ];
  }
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
}: {
  group: ErrorGroup<OverlayErrorItem>;
  selection: Selection | undefined;
  showAll: boolean;
  expanded: boolean;
  onKey: (key: OverlayKey) => void;
  onOpenEditor: (item: OverlayErrorItem, location: LocationToOpen) => void;
  editor: OverlayEditor;
}): Array<HTMLElement> {
  if (group.numErrors === 0) {
    return [];
  }

  // While choosing an editor, the other keys are paused.
  const chooser =
    editor.chooser === undefined
      ? undefined
      : viewEditorChooser(editor.chooser);
  const cancelHints: Array<[keys: Array<OverlayHintKey>, label: string]> = [
    [[["esc", "CancelEditorChooser", true, "Cancel"]], "cancel"],
  ];

  if (showAll || selection === undefined) {
    const items = group.files.flatMap((file) => file.errors);
    return [
      ...items.map((item) => viewOverlayError(item, true, onKey, onOpenEditor)),
      viewOverlayFooter(
        chooser,
        `🚨 ${items.length} error${items.length === 1 ? "" : "s"}`,
        editor.chooser === undefined
          ? [
              [
                [["a", "ToggleShowAll", true, "Show one error at a time"]],
                "show one error at a time",
              ],
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
  const openInName =
    editor.current?.tag === "Preset" ? editor.current.preset.name : "editor";

  return [
    viewOverlayError(item, expanded, onKey, onOpenEditor),
    viewOverlayFooter(
      chooser,
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
            canOpenEditor && editor.current !== undefined
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
  customTemplate,
  customError,
  current,
  commandHint,
  onChoose,
  onShowOther,
  onCustomInput,
  onCustomSubmit,
  onUseExample,
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
              "aria-pressed": (
                current?.tag === "Preset" && current.preset.id === preset.id
              ).toString(),
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
            "aria-pressed": (current?.tag === "Custom").toString(),
          },
          onclick: onShowOther,
        },
        h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "["),
        h(HTMLElement, { localName: "b" }, otherNumber),
        h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "]"),
        " Other",
      ),
    ),
    ...(showOther
      ? viewOtherEditor({
          customTemplate,
          customError,
          current,
          commandHint,
          onCustomInput,
          onCustomSubmit,
          onUseExample,
        })
      : []),
  );
}

function viewOtherEditor({
  customTemplate,
  customError,
  current,
  commandHint,
  onCustomInput,
  onCustomSubmit,
  onUseExample,
}: Pick<
  EditorChooserProps,
  | "customTemplate"
  | "customError"
  | "current"
  | "commandHint"
  | "onCustomInput"
  | "onCustomSubmit"
  | "onUseExample"
>): Array<HTMLElement | undefined> {
  return [
    h(
      HTMLFormElement,
      {
        className: CLASS.editorCustom,
        onsubmit: (event: SubmitEvent) => {
          event.preventDefault();
          onCustomSubmit();
        },
      },
      h(
        HTMLLabelElement,
        {},
        "Editor URL:",
        h(HTMLInputElement, {
          type: "text",
          value: customTemplate,
          spellcheck: false,
          attrs: {
            [DATA_FOCUS_KEY]: "editorCustom",
            "aria-invalid": (customError !== undefined).toString(),
          },
          oninput: (event: Event) => {
            if (event.currentTarget instanceof HTMLInputElement) {
              onCustomInput(event.currentTarget.value);
            }
          },
        }),
      ),
      h(
        HTMLButtonElement,
        {
          type: "submit",
          attrs: {
            [DATA_FOCUS_KEY]: "editorCustomSubmit",
            "aria-pressed": (current?.tag === "Custom").toString(),
          },
        },
        "Use",
      ),
    ),
    customError === undefined
      ? undefined
      : h(HTMLParagraphElement, { attrs: { role: "alert" } }, customError),
    h(
      HTMLParagraphElement,
      { className: CLASS.editorNote },
      "Example: ",
      h(
        HTMLButtonElement,
        {
          className: CLASS.editorExample,
          title: "Use this example",
          attrs: { [DATA_FOCUS_KEY]: "editorExample" },
          onclick: onUseExample,
        },
        EDITOR_URL_EXAMPLE,
      ),
      h(HTMLElement, { localName: "br" }),
      `Placeholders: ${EDITOR_PLACEHOLDERS.join(" ")}`,
    ),
    h(
      HTMLParagraphElement,
      { className: CLASS.editorNote },
      commandHint === null
        ? "Or use the openEditor option to run a command. "
        : "Or run a command, by setting an environment variable. ",
      h(
        HTMLAnchorElement,
        {
          href: "https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations",
          target: "_blank",
          rel: "noreferrer",
        },
        "Clickable error locations",
      ),
    ),
    commandHint === null
      ? undefined
      : h(HTMLPreElement, { className: CLASS.editorNote }, commandHint),
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
        : h(
            HTMLParagraphElement,
            {},
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

// Styled like in the terminal: [key] label
// The keys are buttons, so that they work with the mouse and on touch screens.
// The editor chooser (if open) goes above the footer, sticking with it.
function viewOverlayFooter(
  chooser: HTMLElement | undefined,
  position: string,
  hints: Array<[keys: Array<OverlayHintKey>, label: string] | undefined>,
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
        const [keys, label] = hint;
        const anyEnabled = keys.some(([, , enabled]) => enabled);
        return [
          h(
            HTMLSpanElement,
            {
              className: CLASS.overlayKeyHint,
              attrs: anyEnabled ? {} : { "data-disabled": "" },
            },
            h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "["),
            ...keys.map(([key, overlayKey, enabled, buttonLabel]) =>
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
                key,
              ),
            ),
            h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, "]"),
            ` ${label}`,
          ),
        ];
      }),
    ),
  );
  return h(HTMLDivElement, { className: CLASS.overlayBottom }, chooser, footer);
}

function viewErrorLocation(
  clickable: boolean,
  location: ErrorLocation,
  onOpenEditor: (location: LocationToOpen) => void,
): HTMLElement | string {
  switch (location.tag) {
    case "FileOnly":
      return viewErrorLocationButton(
        clickable,
        { file: location.file, line: 1, column: 1 },
        location.file,
        onOpenEditor,
      );

    case "FileWithLineAndColumn": {
      return viewErrorLocationButton(
        clickable,
        location,
        `${location.file}:${location.line}:${location.column}`,
        onOpenEditor,
      );
    }

    case "Target":
      return `Target: ${location.targetName}`;
  }
}

function viewErrorLocationButton(
  clickable: boolean,
  location: LocationToOpen,
  text: string,
  onOpenEditor: (location: LocationToOpen) => void,
): HTMLButtonElement | string {
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
        text,
      )
    : text;
}
