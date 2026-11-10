import * as Codec from "tiny-decoders";

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
import type { ErrorLocation, OpenEditorError } from "./WebSocketMessages.ts";

export type UiMsg =
  | {
      tag: "ChangedCompilationMode";
      compilationMode: CompilationMode;
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

export type OverlayError = {
  title: string;
  location: ErrorLocation | undefined;
  htmlContent: string;
  // Only set if there are long code excerpts to collapse.
  htmlContentCollapsed: string | undefined;
  foregroundColor: string;
  backgroundColor: string;
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

const CONTAINER_ID = `elm-watch-ui-${UI_VERSION}`;

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
  // elm-watch’s UI is in English, even if the page is in another language.
  // This matters for screen readers, for example. Also, don’t let page
  // translators (like the ones built into Safari and Firefox) translate the UI:
  // When testing a page with a translator on, you don’t want elm-watch’s UI
  // (including error messages and code) to be translated. (These are also set
  // on the elements in the shadow root, since browsers don’t agree on whether
  // they are inherited into it.)
  container.lang = "en";
  container.setAttribute("translate", "no");

  // `<dialog>` elements cannot have a shadow root, so we need an inner element.
  // It covers the whole window, but lets clicks through to the page (except
  // on our own elements).
  const containerInner = h(HTMLDivElement, {});
  containerInner.style.all = "initial";
  containerInner.style.position = "fixed";
  containerInner.style.inset = "0";
  containerInner.style.pointerEvents = "none";
  containerInner.style.zIndex = "2147483647"; // Maximum z-index supported by browsers. (Popover fallback.)
  // `all` does not reset `direction`, so a right-to-left page would otherwise
  // mirror elm-watch’s UI (and mess up the punctuation in error messages).
  // Everything in the shadow root inherits this.
  containerInner.style.direction = "ltr";

  // In Safari, when making a `<dialog>` element into a popovers, it
  // always covers the entire page (making it impossible to click things),
  // which is another reason for having the inner element.
  // This enables popover mode, allowing `.showPopover()` to be called later:
  containerInner.popover = "manual";

  const closeErrorOverlay = (): void => {
    setErrorOverlayOpen(false);
  };

  const overlay = h(HTMLDivElement, {
    className: CLASS.overlay,
    attrs: { "data-test-id": "Overlay" },
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

  for (const element of [overlay, overlayCloseBar, root]) {
    element.lang = "en";
    element.setAttribute("translate", "no");
  }

  const shadowRoot = containerInner.attachShadow({ mode: "open" });
  shadowRoot.append(
    h(HTMLStyleElement, {}, CSS),
    overlay,
    overlayCloseBar,
    root,
  );
  container.append(
    containerInner,
    // Popovers get a `::backdrop`, just like modal dialogs. Pages often style
    // `::backdrop` (for their own dialogs), which would then cover the whole
    // page with elm-watch’s backdrop. Inline styles can’t target
    // pseudo-elements, so this needs a style element in the page (rather than
    // in the shadow root). The ID and `!important` make it win over the page’s
    // styles.
    h(
      HTMLStyleElement,
      {},
      `#${CONTAINER_ID} > div::backdrop { display: none !important; }`,
    ),
  );
  document.documentElement.append(container);

  const entries: Array<TargetEntry> = [];
  let errorOverlayOpen = false;
  // The errors of each target, in the order they first had errors.
  const overlayErrors = new Map<
    string,
    {
      errors: Map<string, OverlayError>;
      sendKey: SendKey | undefined;
      dispatch: (msg: UiMsg) => void;
    }
  >();
  // Like in the terminal: Errors are shown one at a time by default. Not
  // saved: One at a time should be the default each time.
  let overlayShowAll = false;
  let overlayExpanded = false;
  let overlaySelection: Selection | undefined = undefined;
  // What the overlay showed last time it was rendered, to keep the scroll
  // position when it is still the same.
  let overlayRenderedKey: string | undefined = undefined;
  let panelOpen = false;
  let position = loadUiPosition();

  // The errors of all targets put together, without duplicates.
  const getErrorGroup = (): ErrorGroup<OverlayErrorItem> =>
    makeErrorGroup(
      "",
      Array.from(overlayErrors.values(), ({ errors, sendKey, dispatch }) =>
        Array.from(errors, ([id, error]): OverlayErrorItem => ({
          id,
          location: error.location,
          error,
          sendKey,
          dispatch,
        })),
      ).flat(),
    );

  const hasErrors = (): boolean =>
    Array.from(overlayErrors.values()).some(({ errors }) => errors.size > 0);

  const renderOverlay = (): void => {
    const group = getErrorGroup();
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
      }),
    );

    // Start from the top when going to another error.
    overlay.scrollTop = renderedKey === overlayRenderedKey ? scrollTop : 0;
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
    switch (key) {
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
        const msg = getOverlayOpenEditorMsg(item);
        if (item !== undefined && msg !== undefined) {
          item.dispatch(msg);
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

  const render = (): void => {
    const snapshots = getSnapshots();
    toggleButton.hidden = snapshots.length === 0;
    toggleButton.setAttribute("aria-expanded", panelOpen.toString());
    toggleButton.setAttribute("aria-label", summaryLabel(snapshots));

    const worst = worstStatus(snapshots);
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
        ? [h(HTMLSpanElement, { className: CLASS.badge }, "🚀")]
        : []),
    );

    if (panelOpen && snapshots.length > 0) {
      renderPanel(snapshots);
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

  const renderPanel = (snapshots: Array<TargetSnapshot>): void => {
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
        hasErrors: hasErrors(),
        errorOverlayOpen,
        onToggleErrorOverlay: () => {
          // Close the panel, so that it does not cover the errors.
          panelOpen = false;
          setErrorOverlayOpen(!errorOverlayOpen);
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
      typeof container.close === "function" &&
      typeof container.showModal === "function" &&
      // Support users removing elm-watch’s UI (`.showModal()` throws an error in that case).
      container.isConnected
    ) {
      if (hidden) {
        container.close();
      } else if (!container.open) {
        container.showModal();
      }
    }

    moveToTopLayer(container, containerInner);
  };

  const setErrorOverlayOpen = (open: boolean): void => {
    if (open === errorOverlayOpen) {
      return;
    }
    errorOverlayOpen = open;
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
      closeErrorOverlay();
      return;
    }
    const key = overlayKeyFromEvent(event);
    if (
      key === undefined ||
      (key === "ToggleExpanded" && !canToggleExpanded()) ||
      // Let Enter press the focused button.
      (event.key === "Enter" &&
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
      isEscapeLikelyForThePage(containerInner)
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
          moveToTopLayer(container, containerInner);
        },

        flash: (flashType) => {
          const element = toggleButton.querySelector(`.${CLASS.flash}`);
          if (element instanceof HTMLElement) {
            // Restart the animation if it is already running.
            element.removeAttribute("data-flash");
            void element.offsetWidth;
            element.setAttribute("data-flash", flashType);
          }
        },

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

function isEscapeLikelyForThePage(containerInner: HTMLElement): boolean {
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
    // they have not been closed yet.
    return Array.from(document.querySelectorAll(":modal, :popover-open")).some(
      (element) => element !== containerInner,
    );
  } catch {
    // `:modal` or `:popover-open` is not supported.
    return false;
  }
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
  closeButton: "closeButton",
  details: "details",
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

.${CLASS.overlayFooter} {
  position: sticky;
  bottom: 0;
  margin-top: auto;
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
}

.${CLASS.badge} {
  position: absolute;
  right: -4px;
  bottom: -4px;
  font-size: 11px;
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

.${CLASS.closeButton} {
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

.${CLASS.closeButton}:hover {
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

function worstStatus(snapshots: Array<TargetSnapshot>): StatusData | undefined {
  let worst: StatusData | undefined = undefined;
  for (const snapshot of snapshots) {
    const statusData = statusIconAndText(snapshot);
    if (worst === undefined || statusData.severity > worst.severity) {
      worst = statusData;
    }
  }
  return worst;
}

function summaryLabel(snapshots: Array<TargetSnapshot>): string {
  const statuses = snapshots.map(statusIconAndText);
  const worst = worstStatus(snapshots);
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
  hasErrors,
  errorOverlayOpen,
  onToggleErrorOverlay,
  onClose,
  dispatch,
}: {
  snapshots: Array<TargetSnapshot>;
  hasErrors: boolean;
  errorOverlayOpen: boolean;
  onToggleErrorOverlay: () => void;
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
        : undefined,
      h(
        HTMLButtonElement,
        {
          className: CLASS.closeButton,
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
    case " ":
      return "ToggleExpanded";
    case "a":
      return "ToggleShowAll";
    default:
      return undefined;
  }
}

function getOverlayOpenEditorMsg(
  item: OverlayErrorItem | undefined,
): UiMsg | undefined {
  const location = getOpenEditorLocation(item?.location);
  return item?.sendKey === undefined || location === undefined
    ? undefined
    : { tag: "PressedOpenEditor", ...location, sendKey: item.sendKey };
}

function viewOverlay({
  group,
  selection,
  showAll,
  expanded,
  onKey,
}: {
  group: ErrorGroup<OverlayErrorItem>;
  selection: Selection | undefined;
  showAll: boolean;
  expanded: boolean;
  onKey: (key: OverlayKey) => void;
}): Array<HTMLElement> {
  if (group.numErrors === 0) {
    return [];
  }

  if (showAll || selection === undefined) {
    const items = group.files.flatMap((file) => file.errors);
    return [
      ...items.map((item) => viewOverlayError(item, true, onKey)),
      viewOverlayFooter(
        `🚨 ${items.length} error${items.length === 1 ? "" : "s"}`,
        [
          [
            [["a", "ToggleShowAll", true, "Show one error at a time"]],
            "show one error at a time",
          ],
        ],
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

  return [
    viewOverlayError(item, expanded, onKey),
    viewOverlayFooter(
      `🚨 ${position}`,
      [
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
        getOverlayOpenEditorMsg(item) === undefined
          ? undefined
          : [
              [["enter", "OpenEditor", true, "Open in editor"]],
              "open in editor",
            ],
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

function viewOverlayError(
  item: OverlayErrorItem,
  expanded: boolean,
  onKey: (key: OverlayKey) => void,
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
            viewErrorLocation(item.dispatch, item.sendKey, error.location),
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
function viewOverlayFooter(
  position: string,
  hints: Array<[keys: Array<OverlayHintKey>, label: string] | undefined>,
  onKey: (key: OverlayKey) => void,
): HTMLElement {
  return h(
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
