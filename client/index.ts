import { WebSocketToClientMessage } from "./WebSocketMessages";

const VERSION = "%VERSION%";
const TARGET_NAME = "%TARGET_NAME%";
const COMPILED_TIMESTAMP = "%COMPILED_TIMESTAMP%";
const WEBSOCKET_PORT = "%WEBSOCKET_PORT%";
const CONTAINER_ID = "elmWatch";

WebSocketToClientMessage({
  VERSION,
  TARGET_NAME,
  COMPILED_TIMESTAMP,
  WEBSOCKET_PORT,
});

function run(): void {
  const container = getOrCreateContainer();
  const { shadowRoot } = container;

  if (shadowRoot === null) {
    throw new Error("TODO: No shadowRoot");
  }

  const existingTargetRoot = Array.from(shadowRoot.children).find(
    (element) => element.getAttribute("data-target") === TARGET_NAME
  );

  if (existingTargetRoot !== undefined) {
    return;
  }

  const targetRoot = document.createElement("div");
  targetRoot.setAttribute("data-target", TARGET_NAME);
  shadowRoot.append(targetRoot);

  // time to do webSockets!
}

function getOrCreateContainer(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);

  if (existing !== null) {
    return existing;
  }

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.all = "unset";
  container.style.position = "fixed";
  container.style.zIndex = "2147483647"; // Maximum z-index supported by browsers.
  container.style.left = "0";
  container.style.bottom = "0";
  container.attachShadow({ mode: "open" });
  document.documentElement.append(container);
  return container;
}

run();
