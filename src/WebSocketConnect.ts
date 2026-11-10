import * as Codec from "tiny-decoders";
import type WebSocket from "ws";

import { WebSocketToServerMessage } from "../client/WebSocketMessages.ts";
import type { ConfigSource } from "./Config.ts";
import type { OutputRequest, WebSocketConnection } from "./DevServer.ts";
import * as Errors from "./Errors.ts";
import {
  type ApplicationTargetErrorWithMetadata,
  getApplicationTargetsErrors,
  getFlatOutputs,
  type OutputState,
  type Project,
} from "./Project.ts";
import {
  type ElmJsonPath,
  type OutputPath,
  type TargetLocation,
  TargetName,
} from "./Types.ts";
import type { WebSocketUrl } from "./WebSocketUrl.ts";

// Web sockets connect with URL parameters saying which target they are for
// (and more). This parses them, and the messages that web sockets send.

export type OutputPathError = { tag: "OutputPathError" };

// The output is derived from the current project every time, rather than
// stored when the web socket connects, since the web socket might have
// connected during a previous run.
export function getConnectionOutputPath(
  project: Project,
  connection: Pick<WebSocketConnection, "urlParams">,
): OutputPath | OutputPathError {
  return webSocketConnectRequestUrlResultToOutputPath(
    parseWebSocketConnectRequestUrl(project, connection.urlParams),
  );
}

const WebSocketConnectedParams = Codec.fields(
  {
    elmWatchVersion: Codec.field(Codec.string, { optional: true }),
    webSocketToken: Codec.string,
    targetName: TargetName,
    elmCompiledTimestamp: Codec.flatMap(Codec.string, {
      decoder: (string) => {
        const number = Number(string);
        return Number.isFinite(number)
          ? { tag: "Valid", value: number }
          : {
              tag: "DecoderError",
              error: {
                tag: "custom",
                message: "Expected a number",
                got: string,
                path: [],
              },
            };
      },
      encoder: (value) => value.toString(),
    }),
  },
  { allowExtraFields: false },
);

export type ParseWebSocketConnectRequestUrlResult =
  | ParseWebSocketConnectRequestUrlError
  | {
      tag: "ElmJsonError";
      error: ApplicationTargetErrorWithMetadata;
    }
  | {
      tag: "Success";
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
      elmCompiledTimestamp: number;
    };

export type ParseWebSocketConnectRequestUrlError =
  | {
      tag: "ParamsDecodeError";
      error: Codec.DecoderError;
      urlParams: URLSearchParams;
    }
  | {
      tag: "TargetDisabled";
      targetName: TargetName;
      enabledOutputs: Array<TargetLocation>;
      disabledOutputs: Array<TargetLocation>;
    }
  | {
      tag: "TargetNotFound";
      targetName: TargetName;
      enabledOutputs: Array<TargetLocation>;
      disabledOutputs: Array<TargetLocation>;
    }
  | {
      tag: "WrongVersion";
      expectedVersion: "%VERSION%";
      actualVersion: string;
    };

export function parseWebSocketConnectRequestUrl(
  project: Project,
  urlParams: URLSearchParams,
): ParseWebSocketConnectRequestUrlResult {
  const webSocketConnectedParamsResult = WebSocketConnectedParams.decoder(
    Object.fromEntries(urlParams),
  );
  if (webSocketConnectedParamsResult.tag === "DecoderError") {
    return {
      tag: "ParamsDecodeError",
      error: webSocketConnectedParamsResult.error,
      urlParams,
    };
  }
  const webSocketConnectedParams = webSocketConnectedParamsResult.value;

  if (
    webSocketConnectedParams.elmWatchVersion !== undefined &&
    webSocketConnectedParams.elmWatchVersion !== "%VERSION%"
  ) {
    return {
      tag: "WrongVersion",
      expectedVersion: "%VERSION%",
      actualVersion: webSocketConnectedParams.elmWatchVersion,
    };
  }

  const flatOutputs = getFlatOutputs(project);

  const { targetName } = webSocketConnectedParams;
  const matchElmJsonError = getApplicationTargetsErrors(project).find(
    ({ outputPath }) => outputPath.targetName === targetName,
  );
  const matchOutput = flatOutputs.find(
    ({ outputPath }) => outputPath.targetName === targetName,
  );

  if (matchElmJsonError !== undefined) {
    return {
      tag: "ElmJsonError",
      error: matchElmJsonError,
    };
  } else if (matchOutput !== undefined) {
    return {
      tag: "Success",
      elmJsonPath: matchOutput.elmJsonPath,
      outputPath: matchOutput.outputPath,
      outputState: matchOutput.outputState,
      elmCompiledTimestamp: webSocketConnectedParams.elmCompiledTimestamp,
    };
  } else {
    const enabledOutputs = [
      ...project.targetsErrors.map(({ outputPath }) => outputPath),
      ...flatOutputs.map(({ outputPath }) => outputPath),
      ...Array.from(
        project.packages.values(),
        ([packageTarget]) => packageTarget,
      ),
    ];
    const disabledOutputs = Array.from(project.disabledOutputs);
    const disabledMatch = disabledOutputs.find(
      (outputPath) => outputPath.targetName === targetName,
    );
    return disabledMatch === undefined
      ? {
          tag: "TargetNotFound",
          targetName,
          enabledOutputs,
          disabledOutputs,
        }
      : {
          tag: "TargetDisabled",
          targetName,
          enabledOutputs,
          disabledOutputs,
        };
  }
}

function webSocketConnectRequestUrlResultToOutputPath(
  result: ParseWebSocketConnectRequestUrlResult,
): OutputPath | OutputPathError {
  switch (result.tag) {
    case "Success":
      return result.outputPath;
    case "ElmJsonError":
      return result.error.outputPath;
    default: {
      // Make sure only error results are left.
      const _: ParseWebSocketConnectRequestUrlError = result;
      void _;
      return { tag: "OutputPathError" };
    }
  }
}

export function webSocketConnectRequestUrlErrorToString(
  configSource: ConfigSource,
  webSocketUrl: WebSocketUrl | undefined,
  error: ParseWebSocketConnectRequestUrlError,
): string {
  switch (error.tag) {
    case "ParamsDecodeError":
      return Errors.webSocketParamsDecodeError(
        webSocketUrl,
        error.error,
        error.urlParams,
      );

    case "WrongVersion":
      return Errors.webSocketWrongVersion(
        error.expectedVersion,
        error.actualVersion,
      );

    case "TargetNotFound":
      return Errors.webSocketTargetNotFound(
        configSource,
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs,
      );

    case "TargetDisabled":
      return Errors.webSocketTargetDisabled(
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs,
      );
  }
}

type ParseWebSocketToServerMessageResult =
  | {
      tag: "DecoderError";
      error: Codec.DecoderError;
    }
  | {
      tag: "Success";
      message: WebSocketToServerMessage;
    };

export function parseWebSocketToServerMessage(
  data: WebSocket.Data,
): ParseWebSocketToServerMessageResult {
  const stringData =
    typeof data === "string"
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? new TextDecoder("utf8").decode(data)
          : data.toString("utf8");

  const parsed = Codec.JSON.parse(WebSocketToServerMessage, stringData);
  switch (parsed.tag) {
    case "DecoderError":
      return { tag: "DecoderError", error: parsed.error };
    case "Valid":
      return { tag: "Success", message: parsed.value };
  }
}

// Outputs with web sockets or output requests are fully compiled (not just
// typechecked), most recently connected, focused or requested first.
export function makePrioritizedOutputs(
  project: Project,
  connections: Iterable<Pick<WebSocketConnection, "urlParams" | "priority">>,
  outputRequests: Iterable<Pick<OutputRequest, "targetName" | "priority">>,
): Map<TargetName, number> {
  const map = new Map<TargetName, number>();
  const add = (targetName: TargetName, priority: number): void => {
    map.set(targetName, Math.max(priority, map.get(targetName) ?? 0));
  };
  for (const connection of connections) {
    const outputPath = getConnectionOutputPath(project, connection);
    if (outputPath.tag !== "OutputPathError") {
      add(outputPath.targetName, connection.priority);
    }
  }
  for (const { targetName, priority } of outputRequests) {
    add(targetName, priority);
  }
  return map;
}
