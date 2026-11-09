// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";

import {
  removeIndents,
  stringSnapshotSerializer,
  waitOneFrame,
} from "./Helpers.ts";
import { cleanupAfterEachTest, runHotReload } from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

  test.each([
    ["Element", "standard"],
    ["Element", "debug"],
    ["Element", "optimize"],
    ["Document", "standard"],
    ["Document", "debug"],
    ["Document", "optimize"],
    ["Application", "standard"],
    ["Application", "debug"],
    ["Application", "optimize"],
    ["Worker", "standard"],
    ["Worker", "optimize"],
  ] as const)("Port change: %s / %s", async (programType, compilationMode) => {
    const { replace, sendToElm, lastValueFromElm, go } = runHotReload({
      name: "PortChange",
      programType,
      compilationMode,
    });

    await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          await assertInit();
          replace((content) =>
            content.replace("fromJs OriginalFromJs", "fromJs NewFromJs"),
          );
          return "KeepGoing";
        default:
          await assertHotReload();
          return "Stop";
      }
    });

    async function assertInit(): Promise<void> {
      sendToElm(1);
      await waitOneFrame();
      expect(lastValueFromElm.value).toStrictEqual(
        removeIndents(`Before hot reload: [1]`),
      );
    }

    async function assertHotReload(): Promise<void> {
      sendToElm(2);
      await waitOneFrame();
      expect(lastValueFromElm.value).toStrictEqual(
        removeIndents(`Before: [1]. After hot reload: [2]`),
      );
    }
  });
});
