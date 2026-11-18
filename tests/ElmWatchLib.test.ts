// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, expect, test } from "vitest";

import { elmMake, inject } from "../src/elm-watch-lib.ts";
import { markAsTargetName } from "../src/Types.ts";
import { copyFixture } from "./FixtureCopies.ts";
import { TEST_ENV, waitOneFrame } from "./Helpers.ts";

// Like vite-plugin-elm-watch: Hot reloading using `inject` and the hooks it
// adds, without elm-watch’s client (no `globalThis.__ELM_WATCH`).

type HotApp = {
  __elmWatchHotReload: (data: unknown) => Array<unknown>;
};

type Scope = {
  Elm: {
    AddSubscription1: {
      init: ((options: { node: Element }) => HotApp) &
        ((arg: "__elmWatchReturnData") => unknown);
    };
  };
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["__ELM_WATCH_SCHEDULERS"];
  document.body.replaceChildren();
});

test("hot reloading without the client uses the original scheduler queue", async () => {
  // Like a fresh page (see `loadBuiltFiles` in HotHelpers.ts).
  (globalThis as Record<string, unknown>)["__ELM_WATCH_SCHEDULERS"] =
    Object.create(null);

  const dir = copyFixture("hot", "hot-reload");
  const elmFile = path.join(dir, "src", "AddSubscription1.elm");
  const outputPath = path.join(dir, "build", "AddSubscription.js");

  const compile = async (): Promise<Scope> => {
    const { promise } = elmMake({
      elmJsonPath: path.join(dir, "elm.json"),
      compilationMode: "standard",
      inputs: [elmFile],
      outputPath,
      env: { ...process.env, ...TEST_ENV },
    });
    const result = await promise;
    expect(result.tag).toBe("Success");
    const code = inject(
      "standard",
      fs.readFileSync(outputPath, "utf8"),
      markAsTargetName("AddSubscription"),
    );
    // Each script is evaluated into a new scope, like Elm’s `(this)` would be.
    const scope: Record<string, unknown> = {};
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(code).call(scope);
    return scope as Scope;
  };

  const hotReload = async (app: HotApp): Promise<void> => {
    const scope = await compile();
    const data = scope.Elm.AddSubscription1.init("__elmWatchReturnData");
    expect(app.__elmWatchHotReload(data)).toStrictEqual([]);
    await waitOneFrame();
  };

  const replace = (f: (content: string) => string): void => {
    fs.writeFileSync(elmFile, f(fs.readFileSync(elmFile, "utf8")));
  };

  const click = async (): Promise<string> => {
    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("No <main> found.");
    }
    main.click();
    await waitOneFrame();
    return main.outerHTML;
  };

  const node = document.createElement("div");
  document.body.append(node);
  const app = (await compile()).Elm.AddSubscription1.init({ node });
  await waitOneFrame();
  expect(document.body.innerHTML).toBe("<main>0</main>");

  // The Browser.Events effect manager is added by the first hot reload, so it
  // runs code from that hot reload. After the second hot reload, it must
  // still use the same scheduler queue as the rest of the code. Otherwise the
  // effect manager can be stepped while it’s already being stepped, which
  // breaks it. (Same as “Add subscription, then hot reload again” in
  // HotReloadingPortsAndSubscriptions.test.ts.)
  replace((content) => content.replace(/-- /g, "").replace("Sub.none", ""));
  await hotReload(app);
  expect(await click()).toBe("<main>9</main>");

  replace((content) =>
    content.replace(
      "( model + delta, Cmd.none )",
      "( delta + model, Cmd.none )",
    ),
  );
  await hotReload(app);
  expect(await click()).toBe("<main>18</main>");
});
