import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { elmWatch } from "../src/ElmWatch.ts";
import type { HotTestHooks, Msg } from "../src/Hot.ts";
import type { CreateServer } from "../src/Types.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  SilentReadStream,
  TEST_ENV,
  waitFor,
} from "./Helpers.ts";

type Response = { status: number; contentType: string; body: string };

type Kind = "compiled" | "proxy" | "other";

function kind(code: string): Kind {
  return code.includes("elmWatchProxy = true")
    ? "proxy"
    : code.includes("$author$project$Main$main") ||
        code.includes("$author$project$Error$main")
      ? "compiled"
      : "other";
}

let kill: (() => Promise<void>) | undefined = undefined;

afterEach(async () => {
  await kill?.();
  kill = undefined;
});

async function start(
  targets: Array<{ name: string; inputs: Array<string>; output: string }>,
): Promise<{
  dir: string;
  get: (urlPath: string) => Promise<Response>;
  waitForIdle: () => Promise<void>;
  waitForMsg: (tag: Msg["tag"]) => Promise<void>;
  terminal: () => string;
}> {
  const dir = copyFixture("hot", "serve-outputs");
  let server: http.Server | undefined = undefined;
  let isIdle = false;
  let watcherIsReady = false;
  let latestMsg: Msg | undefined = undefined;

  const hotTestHooks: HotTestHooks = {
    kill: undefined,
    onUpdate: (msg, idle) => {
      latestMsg = msg;
      isIdle = idle;
    },
    onWatcherReadyChange: (isReady) => {
      watcherIsReady = isReady;
    },
  };

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();
  stdout.isTTY = false;
  stderr.isTTY = false;

  const done = elmWatch({
    root: dir,
    runMode: "hot",
    staticFilesDir: "public",
    targets: targets.map((target) => ({
      type: "application",
      elmJson: "elm.json",
      ...target,
    })),
    createServer: (({ onRequest, onUpgrade }) => {
      server = http.createServer(onRequest).on("upgrade", onUpgrade);
      return server;
    }) satisfies CreateServer,
    env: { ...process.env, ...TEST_ENV },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
    hotTestHooks,
  });

  kill = async () => {
    await waitFor(() => isIdle);
    await hotTestHooks.kill?.();
    await done;
    expect(stderr.content).toBe("");
  };

  await waitFor(() => server?.listening === true);
  const { port } = (server as unknown as http.Server).address() as AddressInfo;

  const get = (urlPath: string): Promise<Response> =>
    new Promise((resolve, reject) => {
      http
        .get({ port, path: urlPath, agent: false }, (response) => {
          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              contentType: response.headers["content-type"] ?? "",
              body,
            });
          });
        })
        .on("error", reject);
    });

  return {
    dir,
    get,
    waitForIdle: () => waitFor(() => isIdle && watcherIsReady),
    waitForMsg: async (tag) => {
      latestMsg = undefined;
      await waitFor(() => latestMsg?.tag === tag);
    },
    terminal: () => clean(stdout.getOutput()),
  };
}

const MAIN = {
  name: "Main",
  inputs: ["src/Main.elm"],
  output: "public/build/Main.js",
};

describe("serving outputs in hot mode", () => {
  test("request at startup waits for compilation", async () => {
    const { get, terminal } = await start([MAIN]);

    const response = await get("/build/Main.js");
    expect(response.status).toBe(200);
    expect(response.contentType).toBe("text/javascript; charset=utf-8");
    expect(kind(response.body)).toBe("compiled");
    expect(terminal()).toContain("HTTP request needing compilation of: Main");
  });

  test("typechecked only output gets compiled", async () => {
    const { dir, get, waitForIdle } = await start([MAIN]);
    const output = path.join(dir, "public", "build", "Main.js");

    await waitForIdle();
    expect(kind(fs.readFileSync(output, "utf8"))).toBe("proxy");

    const response = await get("/build/Main.js");
    expect(kind(response.body)).toBe("compiled");
    expect(response.body).toBe(fs.readFileSync(output, "utf8"));

    // Up to date: served right away.
    await waitForIdle();
    const again = await get("/build/Main.js?query");
    expect(again.body).toBe(response.body);
  });

  test("out of date output gets recompiled", async () => {
    const { dir, get, waitForIdle, waitForMsg } = await start([MAIN]);
    const mainElm = path.join(dir, "src", "Main.elm");

    const first = await get("/build/Main.js");
    expect(first.body).toContain("text('Main')");
    await waitForIdle();

    // No web socket connection, so this only typechecks, leaving the old
    // compiled output on disk.
    const compiled = waitForMsg("CompilationPartDone");
    fs.writeFileSync(
      mainElm,
      fs.readFileSync(mainElm, "utf8").replace('"Main"', '"Changed"'),
    );
    await compiled;
    await waitForIdle();
    expect(
      fs.readFileSync(path.join(dir, "public", "build", "Main.js"), "utf8"),
    ).toContain("text('Main')");

    const second = await get("/build/Main.js");
    expect(kind(second.body)).toBe("compiled");
    expect(second.body).toContain("text('Changed')");
  });

  test("compile error responds with a proxy file", async () => {
    const { get, waitForIdle } = await start([
      {
        name: "Error",
        inputs: ["src/Error.elm"],
        output: "public/build/Error.js",
      },
    ]);

    await waitForIdle();
    const response = await get("/build/Error.js");
    expect(response.status).toBe(200);
    expect(kind(response.body)).toBe("proxy");
  });

  test("other files are served as usual", async () => {
    const { get } = await start([MAIN]);

    const response = await get("/");
    expect(response.status).toBe(200);
    expect(response.body).toContain("build/Main.js");

    // Falls back to the closest index.html.
    const other = await get("/build/Other.js");
    expect(other.status).toBe(200);
    expect(other.body).toContain("build/Main.js");
  });
});
