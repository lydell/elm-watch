import { formatDate, formatTime } from "../src/Helpers.ts";
import type {
  AbsolutePath,
  BrowserUiPosition,
  CompilationMode,
  CompilationModeWithProxy,
} from "../src/Types.ts";
import type { ErrorLocation, OpenEditorError } from "./WebSocketMessages.ts";

export type UiMsg =
  | {
      tag: "ChangedBrowserUiPosition";
      browserUiPosition: BrowserUiPosition;
      sendKey: SendKey;
    }
  | {
      tag: "ChangedCompilationMode";
      compilationMode: CompilationMode;
      sendKey: SendKey;
    }
  | {
      tag: "ChangedOpenErrorOverlay";
      openErrorOverlay: boolean;
    }
  | {
      tag: "PressedChevron";
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

export type OverlayError = {
  title: string;
  location: ErrorLocation | undefined;
  htmlContent: string;
  foregroundColor: string;
  backgroundColor: string;
};

export type Status =
  | {
      tag: "Busy";
      date: Date;
      errorOverlay: ErrorOverlay | undefined;
    }
  | {
      tag: "CompileError";
      date: Date;
      sendKey: SendKey;
      errorOverlay: ErrorOverlay;
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

export type ErrorOverlay = {
  errors: Map<string, OverlayError>;
  openErrorOverlay: boolean;
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

const CONTAINER_ID = `elm-watch-ui-${UI_VERSION}`;

export type Ui = {
  register: (
    targetName: string,
    initialBrowserUiPosition: BrowserUiPosition,
  ) => UiTarget;
  getBrowserUiPosition: () => BrowserUiPosition;
  isErrorOverlayVisible: () => boolean;
};

export type UiTarget = {
  subscribe: (callbacks: UiTargetCallbacks) => () => void;
  render: (snapshot: TargetSnapshot, manageFocus: boolean) => void;
  flash: (flashType: FlashType) => void;
  setErrors: (
    errors: Map<string, OverlayError>,
    sendKey: SendKey | undefined,
  ) => void;
  setBrowserUiPosition: (browserUiPosition: BrowserUiPosition) => void;
  unregister: () => void;
};

export type UiTargetCallbacks = {
  onUiMsg: (msg: UiMsg) => void;
  onBrowserUiMoved: (browserUiPosition: BrowserUiPosition) => void;
};

export type TargetSnapshot = {
  status: Status;
  compilationMode: CompilationModeWithProxy;
  browserUiPosition: BrowserUiPosition;
  elmCompiledTimestamp: number;
  elmCompiledTimestampBeforeReload: number | undefined;
  uiExpanded: boolean;
  info: Info;
  // For actions that work in more statuses than the ones with a `sendKey`.
  sendKey: SendKey | undefined;
};

type TargetEntry = {
  targetName: string;
  targetRoot: HTMLElement;
  callbacks: UiTargetCallbacks | undefined;
};

export function createUi(): Ui {
  // Remove leftovers, in case the previous UI was not cleaned up.
  document.getElementById(CONTAINER_ID)?.remove();

  const container = h(
    typeof HTMLDialogElement === "function"
      ? HTMLDialogElement
      : (HTMLDivElement as typeof HTMLDialogElement),
    { id: CONTAINER_ID },
  );
  // Note: If we add any more styling to this element, Chrome and Safari expand all the styles
  // in the element inspector, which takes several lines and is pretty distracting.
  container.style.all = "initial";

  // `<dialog>` elements cannot have a shadow root, so we need an inner element.
  const containerInner = h(HTMLDivElement, {});
  containerInner.style.all = "initial";
  containerInner.style.position = "fixed";
  containerInner.style.zIndex = "2147483647"; // Maximum z-index supported by browsers. (Popover fallback.)

  // In Safari, when making a `<dialog>` element into a popovers, it
  // always covers the entire page (making it impossible to click things),
  // which is another reason for having the inner element.
  // This enables popover mode, allowing `.showPopover()` to be called later:
  containerInner.popover = "manual";

  const closeAllErrorOverlays = (): void => {
    for (const entry of entries) {
      entry.callbacks?.onUiMsg({
        tag: "ChangedOpenErrorOverlay",
        openErrorOverlay: false,
      });
    }
  };

  const overlay = h(HTMLDivElement, {
    className: CLASS.overlay,
    attrs: { "data-test-id": "Overlay" },
    hidden: true,
  });

  const overlayCloseButton = h(HTMLButtonElement, {
    className: CLASS.overlayCloseButton,
    attrs: {
      "aria-label": "Close error overlay",
      "data-test-id": "OverlayCloseButton",
    },
    onclick: closeAllErrorOverlays,
  });

  const root = h(HTMLDivElement, { className: CLASS.root });

  const shadowRoot = containerInner.attachShadow({ mode: "open" });
  shadowRoot.append(
    h(HTMLStyleElement, {}, CSS),
    overlay,
    overlayCloseButton,
    root,
  );
  container.append(containerInner);
  document.documentElement.append(container);

  const entries: Array<TargetEntry> = [];
  let browserUiPosition: BrowserUiPosition | undefined = undefined;

  const applyBrowserUiPosition = (
    newBrowserUiPosition: BrowserUiPosition,
  ): void => {
    browserUiPosition = newBrowserUiPosition;

    for (const [key, value] of Object.entries(
      browserUiPositionToCss(newBrowserUiPosition),
    )) {
      containerInner.style.setProperty(key, value);
    }

    const isInBottomHalf =
      newBrowserUiPosition === "BottomLeft" ||
      newBrowserUiPosition === "BottomRight";
    root.classList.toggle(CLASS.rootBottomHalf, isInBottomHalf);
  };

  const onKeydown = (event: KeyboardEvent): void => {
    if (overlay.hasChildNodes() && event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeAllErrorOverlays();
    }
  };

  // When the page opens a popover, modal dialog etc., they end up on top of
  // elm-watch. Move elm-watch back to the top when that happens. `toggle` does
  // not bubble, so listen in the capture phase. Dialogs fire `toggle` in newer
  // browsers only, so also listen for `close` (to remove the inactive state).
  // Cap the number of moves per frame, in case some other script on the page
  // also tries to stay on top this way, which would cause an infinite loop.
  let movesThisFrame = 0;
  const onTopLayerChange = (event: Event): void => {
    if (event.target === containerInner || movesThisFrame >= 10) {
      return;
    }
    if (movesThisFrame === 0) {
      requestAnimationFrame(() => {
        movesThisFrame = 0;
      });
    }
    movesThisFrame++;
    moveToTopLayer(container, containerInner);
  };

  const addListeners = (): void => {
    window.addEventListener("keydown", onKeydown, true);
    document.addEventListener("toggle", onTopLayerChange, true);
    document.addEventListener("close", onTopLayerChange, true);
  };

  // Called when the last target unregisters. The DOM elements are left as-is,
  // so they can be inspected after `__ELM_WATCH.KILL_MATCHING` (used in tests).
  const removeListeners = (): void => {
    window.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("toggle", onTopLayerChange, true);
    document.removeEventListener("close", onTopLayerChange, true);
  };

  return {
    register: (targetName, initialBrowserUiPosition) => {
      const entry: TargetEntry = {
        targetName,
        targetRoot: createTargetRoot(targetName),
        callbacks: undefined,
      };
      if (entries.length === 0) {
        addListeners();
      }
      entries.push(entry);
      root.append(entry.targetRoot);

      // Only the first target is in charge of the browser UI position.
      const isFirstTarget = (): boolean => entries[0] === entry;

      if (isFirstTarget()) {
        applyBrowserUiPosition(initialBrowserUiPosition);
      }

      return {
        subscribe: (callbacks) => {
          entry.callbacks = callbacks;
          return () => {
            entry.callbacks = undefined;
          };
        },

        render: (snapshot, manageFocus) => {
          const { targetRoot } = entry;

          targetRoot.replaceChildren(
            view((msg) => {
              entry.callbacks?.onUiMsg(msg);
            }, snapshot),
          );

          const firstFocusableElement =
            targetRoot.querySelector(`button, [tabindex]`);
          if (manageFocus && firstFocusableElement instanceof HTMLElement) {
            firstFocusableElement.focus();
          }

          // elm-watch’s overlay needs to be a modal `<dialog>` for two reasons:
          // - It makes sure you cannot interact with elements behind it.
          // - We need it to win against other modal `<dialog>`s on the page – they make
          //   all other content on the page, including our overlay, inert.
          // Support for `<dialog>` shipped in Firefox and Safari in 2022-03-14.
          // These methods are not supported in JSDOM, so we only call them if they exist.
          if (
            typeof container.close === "function" &&
            typeof container.showModal === "function" &&
            // Support users removing elm-watch’s UI (`.showModal()` throws an error in that case).
            container.isConnected
          ) {
            if (overlay.hidden !== false) {
              container.close();
            } else {
              container.showModal();
            }
          }

          moveToTopLayer(container, containerInner);
        },

        flash: (flashType) => {
          for (const element of entry.targetRoot.querySelectorAll(
            `.${CLASS.flash}`,
          )) {
            element.setAttribute("data-flash", flashType);
          }
        },

        setErrors: (errors, sendKey) => {
          updateErrorOverlay(
            entry.targetName,
            (msg) => {
              entry.callbacks?.onUiMsg(msg);
            },
            sendKey,
            errors,
            overlay,
            overlayCloseButton,
          );
        },

        setBrowserUiPosition: (newBrowserUiPosition) => {
          if (!isFirstTarget()) {
            return;
          }
          applyBrowserUiPosition(newBrowserUiPosition);
          for (const otherEntry of entries) {
            otherEntry.callbacks?.onBrowserUiMoved(newBrowserUiPosition);
          }
        },

        unregister: () => {
          const index = entries.indexOf(entry);
          if (index === -1) {
            return;
          }
          entries.splice(index, 1);
          entry.targetRoot.remove();
          if (entries.length === 0) {
            removeListeners();
          }
        },
      };
    },

    getBrowserUiPosition: () => {
      if (browserUiPosition === undefined) {
        throw new Error(
          "elm-watch: getBrowserUiPosition was called before any target was registered.",
        );
      }
      return browserUiPosition;
    },

    isErrorOverlayVisible: () => overlay.hidden === false,
  };
}

function moveToTopLayer(
  container: HTMLDialogElement,
  containerInner: HTMLElement,
): void {
  // Put the inner container in the top level. This is needed to stay on top of
  // popovers. See: https://developer.mozilla.org/en-US/docs/Glossary/Top_layer
  // The latest shown popover gets drawn on top, so we need to enter and exit
  // popover frequently for elm-watch to force it to be on the very top.
  // `.showPopover()` shipped in Firefox 125, released 2024-04-16.
  // At the time of writing (2024-10-27) that was a bit too recent to be
  // required, so we use only call the methods if they exist. The element falls
  // back to having the highest z-index.
  if (
    typeof containerInner.hidePopover === "function" &&
    typeof containerInner.showPopover === "function" &&
    // Support users removing elm-watch’s UI (`.showPopover()` throws an error in that case).
    containerInner.isConnected
  ) {
    containerInner.hidePopover();
    containerInner.showPopover();
  }

  // A modal dialog on the page makes everything outside it inert, including
  // elm-watch – even though we are drawn on top. Show that elm-watch cannot be
  // interacted with in that case (unless our own dialog is the modal one).
  let isInert = false;
  try {
    isInert =
      document.querySelector(":modal") !== null && !container.matches(":modal");
  } catch {
    // `:modal` is not supported.
  }
  containerInner.style.opacity = isInert ? "0.5" : "";
}

function createTargetRoot(targetName: string): HTMLElement {
  return h(HTMLDivElement, {
    className: CLASS.targetRoot,
    attrs: { "data-target": targetName },
  });
}

type PositionCss<Position> = {
  top: Position;
  bottom: Position;
  left: Position;
  right: Position;
};

function browserUiPositionToCss(
  browserUiPosition: BrowserUiPosition,
): PositionCss<"-1px" | "auto"> {
  switch (browserUiPosition) {
    case "TopLeft":
      return { top: "-1px", bottom: "auto", left: "-1px", right: "auto" };
    case "TopRight":
      return { top: "-1px", bottom: "auto", left: "auto", right: "-1px" };
    case "BottomLeft":
      return { top: "auto", bottom: "-1px", left: "-1px", right: "auto" };
    case "BottomRight":
      return { top: "auto", bottom: "-1px", left: "auto", right: "-1px" };
  }
}

function browserUiPositionToCssForChooser(
  browserUiPosition: BrowserUiPosition,
): PositionCss<"0" | "auto"> {
  switch (browserUiPosition) {
    case "TopLeft":
      return { top: "auto", bottom: "0", left: "auto", right: "0" };
    case "TopRight":
      return { top: "auto", bottom: "0", left: "0", right: "auto" };
    case "BottomLeft":
      return { top: "0", bottom: "auto", left: "auto", right: "0" };
    case "BottomRight":
      return { top: "0", bottom: "auto", left: "0", right: "auto" };
  }
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
  ...children: Array<HTMLElement | string | undefined>
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

export type Info = {
  version: string;
  webSocketUrl: URL;
  targetName: string;
  originalCompilationMode: CompilationModeWithProxy;
  debugModeToggled: Toggled;
};

const CLASS = {
  browserUiPositionButton: "browserUiPositionButton",
  browserUiPositionChooser: "browserUiPositionChooser",
  chevronButton: "chevronButton",
  compilationModeWithIcon: "compilationModeWithIcon",
  container: "container",
  debugModeIcon: "debugModeIcon",
  envNotSet: "envNotSet",
  errorLocationButton: "errorLocationButton",
  errorTitle: "errorTitle",
  expandedUiContainer: "expandedUiContainer",
  flash: "flash",
  overlay: "overlay",
  overlayCloseButton: "overlayCloseButton",
  root: "root",
  rootBottomHalf: "rootBottomHalf",
  shortStatusContainer: "shortStatusContainer",
  targetName: "targetName",
  targetRoot: "targetRoot",
};

export type FlashType = "error" | "success";

const CHEVRON_UP = "▲";
const CHEVRON_DOWN = "▼";

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

fieldset {
  display: grid;
  gap: 0.25em;
  margin: 0;
  border: 1px solid var(--grey);
  padding: 0.25em 0.75em 0.5em;
}

fieldset:disabled {
  color: var(--grey);
}

p,
dd {
  margin: 0;
}

dl {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.25em 1em;
  margin: 0;
  white-space: nowrap;
}

dt {
  text-align: right;
  color: var(--grey);
}

time {
  display: inline-grid;
  overflow: hidden;
}

time::after {
  content: attr(data-format);
  visibility: hidden;
  height: 0;
}

.${CLASS.overlay} {
  position: fixed;
  z-index: -2;
  inset: 0;
  overflow-y: auto;
  padding: 2ch 0;
  user-select: text;
}

.${CLASS.overlayCloseButton} {
  position: fixed;
  z-index: -1;
  top: 0;
  right: 0;
  appearance: none;
  padding: 1em;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
  font-size: 1.25em;
  filter: drop-shadow(0 0 0.125em var(--backgroundColor));
}

.${CLASS.overlayCloseButton}::before,
.${CLASS.overlayCloseButton}::after {
  content: "";
  display: block;
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.125em;
  height: 1em;
  background-color: var(--foregroundColor);
  transform: translate(-50%, -50%) rotate(45deg);
}

.${CLASS.overlayCloseButton}::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.${CLASS.overlay},
.${CLASS.overlay} pre {
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
}

.${CLASS.overlay} details {
  --border-thickness: 0.125em;
  border-top: var(--border-thickness) solid;
  margin: 2ch 0;
}

.${CLASS.overlay} summary {
  cursor: pointer;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 2ch;
  word-break: break-word;
}

.${CLASS.overlay} summary::-webkit-details-marker {
  display: none;
}

.${CLASS.overlay} summary::marker {
  content: none;
}

.${CLASS.overlay} summary > * {
  pointer-events: auto;
}

.${CLASS.errorTitle} {
  display: inline-block;
  font-weight: bold;
  --padding: 1ch;
  padding: 0 var(--padding);
  transform: translate(calc(var(--padding) * -1), calc(-50% - var(--border-thickness) / 2));
}

.${CLASS.errorTitle}::before {
  content: "${CHEVRON_DOWN}";
  display: inline-block;
  margin-right: 1ch;
  transform: translateY(-0.0625em);
}

details[open] > summary > .${CLASS.errorTitle}::before {
  content: "${CHEVRON_UP}";
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

.${CLASS.overlay} pre {
  margin: 0;
  padding: 2ch;
  overflow-x: auto;
}

.${CLASS.root} {
  all: initial;
  --grey: #767676;
  display: flex;
  align-items: start;
  overflow: auto;
  max-height: 100vh;
  max-width: 100vw;
  color: black;
  font-family: system-ui;
}

.${CLASS.rootBottomHalf} {
  align-items: end;
}

.${CLASS.targetRoot} + .${CLASS.targetRoot} {
  margin-left: -1px;
}

.${CLASS.targetRoot}:only-of-type .${CLASS.debugModeIcon},
.${CLASS.targetRoot}:only-of-type .${CLASS.targetName} {
  display: none;
}

.${CLASS.container} {
  display: flex;
  flex-direction: column-reverse;
  background-color: white;
  border: 1px solid var(--grey);
}

.${CLASS.rootBottomHalf} .${CLASS.container} {
  flex-direction: column;
}

.${CLASS.envNotSet} {
  display: grid;
  gap: 0.75em;
  margin: 2em 0;
}

.${CLASS.envNotSet},
.${CLASS.root} pre {
  border-left: 0.25em solid var(--grey);
  padding-left: 0.5em;
}

.${CLASS.root} pre {
  margin: 0;
  white-space: pre-wrap;
}

.${CLASS.expandedUiContainer} {
  padding: 1em;
  padding-top: 0.75em;
  display: grid;
  gap: 0.75em;
  outline: none;
  contain: paint;
}

.${CLASS.rootBottomHalf} .${CLASS.expandedUiContainer} {
  padding-bottom: 0.75em;
}

.${CLASS.expandedUiContainer}:is(.length0, .length1) {
  grid-template-columns: min-content;
}

.${CLASS.expandedUiContainer} > dl {
  justify-self: start;
}

.${CLASS.expandedUiContainer} label {
  display: grid;
  grid-template-columns: min-content auto;
  align-items: center;
  gap: 0.25em;
}

.${CLASS.expandedUiContainer} label.Disabled {
  color: var(--grey);
}

.${CLASS.expandedUiContainer} label > small {
  grid-column: 2;
}

.${CLASS.compilationModeWithIcon} {
  display: flex;
  align-items: center;
  gap: 0.25em;
}

.${CLASS.browserUiPositionChooser} {
  position: absolute;
  display: grid;
  grid-template-columns: min-content min-content;
  pointer-events: none;
}

.${CLASS.browserUiPositionButton} {
  appearance: none;
  padding: 0;
  border: none;
  background: none;
  border-radius: none;
  pointer-events: auto;
  width: 1em;
  height: 1em;
  text-align: center;
  line-height: 1em;
}

.${CLASS.browserUiPositionButton}:hover {
  background-color: rgba(0, 0, 0, 0.25);
}

.${CLASS.targetRoot}:not(:first-child) .${CLASS.browserUiPositionChooser} {
  display: none;
}

.${CLASS.shortStatusContainer} {
  line-height: 1;
  padding: 0.25em;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.25em;
}

[data-flash]::before {
  content: "";
  position: absolute;
  margin-top: 0.5em;
  margin-left: 0.5em;
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

.${CLASS.chevronButton} {
  appearance: none;
  border: none;
  border-radius: 0;
  background: none;
  padding: 0;
  cursor: pointer;
}
`;

function view(
  dispatch: (msg: UiMsg) => void,
  snapshot: TargetSnapshot,
): HTMLElement {
  const statusData: StatusData = {
    ...statusIconAndText(snapshot),
    ...viewStatus(dispatch, snapshot),
  };

  return h(
    HTMLDivElement,
    { className: CLASS.container },
    snapshot.uiExpanded
      ? viewExpandedUi(snapshot, statusData, dispatch)
      : undefined,
    h(
      HTMLDivElement,
      {
        className: CLASS.shortStatusContainer,
        // Placed on the div to increase clickable area.
        onclick: () => {
          dispatch({ tag: "PressedChevron" });
        },
      },
      h(
        HTMLButtonElement,
        {
          className: CLASS.chevronButton,
          attrs: { "aria-expanded": snapshot.uiExpanded.toString() },
        },
        icon(
          snapshot.uiExpanded ? CHEVRON_UP : CHEVRON_DOWN,
          snapshot.uiExpanded ? "Collapse elm-watch" : "Expand elm-watch",
        ),
      ),
      compilationModeIcon(snapshot.compilationMode),
      icon(statusData.icon, statusData.status, {
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
      h(
        HTMLTimeElement,
        { dateTime: snapshot.status.date.toISOString() },
        formatTime(snapshot.status.date),
      ),
      h(
        HTMLSpanElement,
        { className: CLASS.targetName },
        snapshot.info.targetName,
      ),
    ),
  );
}

function icon(
  emoji: string,
  alt: string,
  props?: Partial<HTMLSpanElement>,
): HTMLElement {
  return h(
    HTMLSpanElement,
    { attrs: { "aria-label": alt }, ...props },
    h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, emoji),
  );
}

function viewExpandedUi(
  { status, info, browserUiPosition, sendKey }: TargetSnapshot,
  statusData: StatusData,
  dispatch: (msg: UiMsg) => void,
): HTMLElement {
  const items: Array<[string, HTMLElement | string]> = [
    ["target", info.targetName],
    ["elm-watch", info.version],
    ["web socket", printWebSocketUrl(info.webSocketUrl)],
    [
      "updated",
      h(
        HTMLTimeElement,
        {
          dateTime: status.date.toISOString(),
          attrs: { "data-format": "2044-04-30 04:44:44" },
        },
        `${formatDate(status.date)} ${formatTime(status.date)}`,
      ),
    ],
    ["status", statusData.status],
    ...statusData.dl,
  ];

  return h(
    HTMLDivElement,
    {
      className: `${CLASS.expandedUiContainer} length${statusData.content.length}`,
      attrs: {
        // Using the attribute instead of the property so that it can be
        // selected with `querySelector`.
        tabindex: "-1",
      },
    },
    h(
      HTMLDListElement,
      {},
      ...items.flatMap(([key, value]) => [
        h(HTMLElement, { localName: "dt" }, key),
        h(HTMLElement, { localName: "dd" }, value),
      ]),
    ),
    ...statusData.content,
    sendKey === undefined
      ? undefined
      : viewBrowserUiPositionChooser(browserUiPosition, dispatch, sendKey),
  );
}

const allBrowserUiPositionsInOrder: Array<BrowserUiPosition> = [
  "TopLeft",
  "TopRight",
  "BottomLeft",
  "BottomRight",
];

function viewBrowserUiPositionChooser(
  currentPosition: BrowserUiPosition,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey,
): HTMLElement {
  const arrows = getBrowserUiPositionArrows(currentPosition);
  return h(
    HTMLDivElement,
    {
      className: CLASS.browserUiPositionChooser,
      style: browserUiPositionToCssForChooser(currentPosition),
    },
    ...allBrowserUiPositionsInOrder.map((position) => {
      const arrow = arrows[position];
      return arrow === undefined
        ? h(HTMLDivElement, { style: { visibility: "hidden" } }, "·")
        : h(
            HTMLButtonElement,
            {
              className: CLASS.browserUiPositionButton,
              attrs: { "data-position": position },
              onclick: () => {
                dispatch({
                  tag: "ChangedBrowserUiPosition",
                  browserUiPosition: position,
                  sendKey,
                });
              },
            },
            arrow,
          );
    }),
  );
}

const ARROW_UP = "↑";
const ARROW_DOWN = "↓";
const ARROW_LEFT = "←";
const ARROW_RIGHT = "→";
const ARROW_UP_LEFT = "↖";
const ARROW_UP_RIGHT = "↗";
const ARROW_DOWN_LEFT = "↙";
const ARROW_DOWN_RIGHT = "↘";

function getBrowserUiPositionArrows(browserUiPosition: BrowserUiPosition): {
  [key in BrowserUiPosition]: string | undefined;
} {
  switch (browserUiPosition) {
    case "TopLeft":
      return {
        TopLeft: undefined,
        TopRight: ARROW_RIGHT,
        BottomLeft: ARROW_DOWN,
        BottomRight: ARROW_DOWN_RIGHT,
      };

    case "TopRight":
      return {
        TopLeft: ARROW_LEFT,
        TopRight: undefined,
        BottomLeft: ARROW_DOWN_LEFT,
        BottomRight: ARROW_DOWN,
      };

    case "BottomLeft":
      return {
        TopLeft: ARROW_UP,
        TopRight: ARROW_UP_RIGHT,
        BottomLeft: undefined,
        BottomRight: ARROW_RIGHT,
      };

    case "BottomRight":
      return {
        TopLeft: ARROW_UP_LEFT,
        TopRight: ARROW_UP,
        BottomLeft: ARROW_LEFT,
        BottomRight: undefined,
      };
  }
}

type StatusData = {
  icon: string;
  status: string;
  dl: Array<[string, string]>;
  content: Array<HTMLElement>;
};

export function statusIconAndText(
  snapshot: Pick<
    TargetSnapshot,
    "status" | "elmCompiledTimestamp" | "elmCompiledTimestampBeforeReload"
  >,
): Pick<StatusData, "icon" | "status"> {
  switch (snapshot.status.tag) {
    case "Busy":
      return {
        icon: "⏳",
        status: "Waiting for compilation",
      };

    case "CompileError":
      return {
        icon: "🚨",
        status: "Compilation error",
      };

    case "Connecting":
      return {
        icon: "🔌",
        status: "Connecting",
      };

    case "ElmJsonError":
      return {
        icon: "🚨",
        status: "elm.json or inputs error",
      };

    case "EvalError":
      return {
        icon: "⛔️",
        status: "Eval error",
      };

    case "Idle":
      return {
        icon: "✅",
        status: "Successfully compiled",
      };

    case "SleepingBeforeReconnect":
      return {
        icon: "🔌",
        status: "Sleeping",
      };

    case "UnexpectedError":
      return {
        icon: "❌",
        status: "Unexpected error",
      };

    case "WaitingForReload":
      return snapshot.elmCompiledTimestamp ===
        snapshot.elmCompiledTimestampBeforeReload
        ? {
            icon: "❌",
            status: "Reload trouble",
          }
        : {
            icon: "⏳",
            status: "Waiting for reload",
          };
  }
}

function viewStatus(
  dispatch: (msg: UiMsg) => void,
  snapshot: TargetSnapshot,
): Pick<StatusData, "content" | "dl"> {
  const { status, compilationMode, info } = snapshot;
  switch (status.tag) {
    case "Busy":
      return {
        dl: [],
        content: [
          ...viewCompilationModeChooser({
            dispatch,
            sendKey: undefined,
            compilationMode,
            // Avoid the warning flashing by when switching modes (which is usually very fast).
            warnAboutCompilationModeMismatch: false,
            info,
          }),
          ...(status.errorOverlay === undefined
            ? []
            : [viewErrorOverlayToggleButton(dispatch, status.errorOverlay)]),
        ],
      };

    case "CompileError":
      return {
        dl: [],
        content: [
          ...viewCompilationModeChooser({
            dispatch,
            sendKey: status.sendKey,
            compilationMode,
            warnAboutCompilationModeMismatch: true,
            info,
          }),
          viewErrorOverlayToggleButton(dispatch, status.errorOverlay),
          ...(status.openEditorError === undefined
            ? []
            : viewOpenEditorError(status.openEditorError)),
        ],
      };

    case "Connecting":
      return {
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", printRetryWaitMs(status.attemptNumber)],
        ],
        content: [
          ...viewHttpsInfo(info.webSocketUrl),
          h(HTMLButtonElement, { disabled: true }, "Connecting web socket…"),
        ],
      };

    case "ElmJsonError":
      return {
        dl: [],
        content: [
          h(HTMLPreElement, { style: { minWidth: "80ch" } }, status.error),
        ],
      };

    case "EvalError":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "Check the console in the browser developer tools to see errors!",
          ),
        ],
      };

    case "Idle":
      return {
        dl: [],
        content: viewCompilationModeChooser({
          dispatch,
          sendKey: status.sendKey,
          compilationMode,
          warnAboutCompilationModeMismatch: true,
          info,
        }),
      };

    case "SleepingBeforeReconnect":
      return {
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", printRetryWaitMs(status.attemptNumber)],
        ],
        content: [
          ...viewHttpsInfo(info.webSocketUrl),
          h(
            HTMLButtonElement,
            {
              onclick: () => {
                dispatch({ tag: "PressedReconnectNow" });
              },
            },
            "Reconnect web socket now",
          ),
        ],
      };

    case "UnexpectedError":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "I ran into an unexpected error! This is the error message:",
          ),
          h(HTMLPreElement, {}, status.message),
        ],
      };

    case "WaitingForReload":
      return {
        dl: [],
        content:
          snapshot.elmCompiledTimestamp ===
          snapshot.elmCompiledTimestampBeforeReload
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
            : [h(HTMLParagraphElement, {}, "Waiting for other targets…")],
      };
  }
}

function viewErrorOverlayToggleButton(
  dispatch: (msg: UiMsg) => void,
  errorOverlay: ErrorOverlay,
): HTMLElement {
  return h(
    HTMLButtonElement,
    {
      attrs: {
        "data-test-id": errorOverlay.openErrorOverlay
          ? "HideErrorOverlayButton"
          : "ShowErrorOverlayButton",
      },
      onclick: () => {
        dispatch({
          tag: "ChangedOpenErrorOverlay",
          openErrorOverlay: !errorOverlay.openErrorOverlay,
        });
      },
    },
    errorOverlay.openErrorOverlay ? "Hide errors" : "Show errors",
  );
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

function compilationModeIcon(
  compilationMode: CompilationModeWithProxy,
): HTMLElement | undefined {
  switch (compilationMode) {
    case "proxy":
      return undefined;
    case "debug":
      return icon("🐛", "Debug mode", { className: CLASS.debugModeIcon });
    case "standard":
      return undefined;
    case "optimize":
      return icon("🚀", "Optimize mode");
  }
}

function printWebSocketUrl(url: URL): string {
  const hostname = url.hostname.endsWith(".localhost")
    ? "localhost"
    : url.hostname;
  return `${url.protocol}//${hostname}:${url.port}${url.pathname}`;
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

function viewCompilationModeChooser({
  dispatch,
  sendKey,
  compilationMode: selectedMode,
  warnAboutCompilationModeMismatch,
  info,
}: {
  dispatch: (msg: UiMsg) => void;
  sendKey: SendKey | undefined;
  compilationMode: CompilationModeWithProxy;
  warnAboutCompilationModeMismatch: boolean;
  info: Info;
}): Array<HTMLElement> {
  const compilationModes: Array<CompilationModeOption> = [
    { mode: "debug", name: "Debug", toggled: info.debugModeToggled },
    { mode: "standard", name: "Standard", toggled: { tag: "Enabled" } },
    { mode: "optimize", name: "Optimize", toggled: { tag: "Enabled" } },
  ];

  return [
    h(
      HTMLFieldSetElement,
      { disabled: sendKey === undefined },
      h(HTMLLegendElement, {}, "Compilation mode"),
      ...compilationModes.map(({ mode, name, toggled: status }) => {
        const nameWithIcon = h(
          HTMLSpanElement,
          { className: CLASS.compilationModeWithIcon },
          name,
          mode === selectedMode ? compilationModeIcon(mode) : undefined,
        );

        return h(
          HTMLLabelElement,
          { className: status.tag },
          h(HTMLInputElement, {
            type: "radio",
            name: `CompilationMode-${info.targetName}`,
            value: mode,
            checked: mode === selectedMode,
            disabled: sendKey === undefined || status.tag === "Disabled",
            onchange:
              sendKey === undefined
                ? null
                : () => {
                    dispatch({
                      tag: "ChangedCompilationMode",
                      compilationMode: mode,
                      sendKey,
                    });
                  },
          }),
          ...(status.tag === "Enabled"
            ? [
                nameWithIcon,
                warnAboutCompilationModeMismatch &&
                mode === selectedMode &&
                selectedMode !== info.originalCompilationMode &&
                info.originalCompilationMode !== "proxy"
                  ? h(
                      HTMLElement,
                      { localName: "small" },
                      `Note: The code currently running is in ${info.originalCompilationMode} mode.`,
                    )
                  : undefined,
              ]
            : [
                nameWithIcon,
                h(HTMLElement, { localName: "small" }, status.reason),
              ]),
        );
      }),
    ),
  ];
}

const DATA_TARGET_NAMES = "data-target-names";

function updateErrorOverlay(
  targetName: string,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  errors: Map<string, OverlayError>,
  overlay: HTMLElement,
  overlayCloseButton: HTMLElement,
): void {
  const existingErrorElements = new Map<
    string,
    { targetNames: Set<string>; element: Element }
  >(
    Array.from(overlay.children, (element) => [
      element.id,
      {
        targetNames: new Set(
          // Newline is not a valid target name character.
          (element.getAttribute(DATA_TARGET_NAMES) ?? "").split("\n"),
        ),
        element,
      },
    ]),
  );

  for (const [id, { targetNames, element }] of existingErrorElements) {
    if (targetNames.has(targetName) && !errors.has(id)) {
      targetNames.delete(targetName);
      if (targetNames.size === 0) {
        element.remove();
      } else {
        element.setAttribute(DATA_TARGET_NAMES, [...targetNames].join("\n"));
      }
    }
  }

  let previousElement: Element | undefined = undefined;

  for (const [id, error] of errors) {
    const maybeExisting = existingErrorElements.get(id);
    if (maybeExisting === undefined) {
      const element = viewOverlayError(
        targetName,
        dispatch,
        sendKey,
        id,
        error,
      );
      if (previousElement === undefined) {
        overlay.prepend(element);
      } else {
        previousElement.after(element);
      }
      overlay.style.backgroundColor = error.backgroundColor;
      overlayCloseButton.style.setProperty(
        "--foregroundColor",
        error.foregroundColor,
      );
      overlayCloseButton.style.setProperty(
        "--backgroundColor",
        error.backgroundColor,
      );
      previousElement = element;
    } else {
      if (!maybeExisting.targetNames.has(targetName)) {
        maybeExisting.element.setAttribute(
          DATA_TARGET_NAMES,
          [...maybeExisting.targetNames, targetName].join("\n"),
        );
      }
      previousElement = maybeExisting.element;
    }
  }

  const hidden = !overlay.hasChildNodes();
  overlay.hidden = hidden;
  overlayCloseButton.hidden = hidden;

  // Avoid drawing the close button on top of a scrollbar.
  overlayCloseButton.style.right = `${
    overlay.offsetWidth - overlay.clientWidth
  }px`;
}

function viewOverlayError(
  targetName: string,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  id: string,
  error: OverlayError,
): HTMLElement {
  return h(
    HTMLDetailsElement,
    {
      open: true,
      id,
      style: {
        backgroundColor: error.backgroundColor,
        color: error.foregroundColor,
      },
      attrs: {
        [DATA_TARGET_NAMES]: targetName,
      },
    },
    h(
      HTMLElement,
      { localName: "summary" },
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
            viewErrorLocation(dispatch, sendKey, error.location),
          ),
    ),
    h(HTMLPreElement, { innerHTML: error.htmlContent }),
  );
}

function viewErrorLocation(
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  location: ErrorLocation,
): HTMLElement | string {
  switch (location.tag) {
    case "FileOnly":
      return viewErrorLocationButton(
        dispatch,
        sendKey,
        {
          file: location.file,
          line: 1,
          column: 1,
        },
        location.file,
      );

    case "FileWithLineAndColumn": {
      return viewErrorLocationButton(
        dispatch,
        sendKey,
        location,
        `${location.file}:${location.line}:${location.column}`,
      );
    }

    case "Target":
      return `Target: ${location.targetName}`;
  }
}

function viewErrorLocationButton(
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  location: {
    file: AbsolutePath;
    line: number;
    column: number;
  },
  text: string,
): HTMLButtonElement | string {
  return sendKey === undefined
    ? text
    : h(
        HTMLButtonElement,
        {
          className: CLASS.errorLocationButton,
          onclick: () => {
            dispatch({
              tag: "PressedOpenEditor",
              file: location.file,
              line: location.line,
              column: location.column,
              sendKey,
            });
          },
        },
        text,
      );
}
