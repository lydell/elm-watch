import { WebSocketToClientMessage } from "./WebSocketMessages";

const VERSION = "%VERSION%";
const TARGET_NAME = "%TARGET_NAME%";
const COMPILED_TIMESTAMP = "%COMPILED_TIMESTAMP%";
const WEBSOCKET_PORT = "%WEBSOCKET_PORT%";

WebSocketToClientMessage({
  VERSION,
  TARGET_NAME,
  COMPILED_TIMESTAMP,
  WEBSOCKET_PORT,
});
