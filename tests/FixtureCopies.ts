import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, onTestFinished } from "vitest";

import { rimraf, TEST_ENV } from "./Helpers.ts";
import { spawnSync } from "./Spawn.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");
const FIXTURE_COPIES_DIR = path.join(import.meta.dirname, "fixtures-copies");
const ELM_STUFF_CACHE_DIR = path.join(FIXTURE_COPIES_DIR, "elm-stuff-cache");
const ELM_JSON_MTIME = new Date("2000-01-01T00:00:00Z");

const fixtureCopies = new Map<string, string>();
let fixtureFiles: Array<string> | undefined = undefined;

// Each test gets its own copy of the fixtures it uses, so that tests can’t
// affect each other via leftover files (elm-stuff/, build/, lock files, etc.),
// and so that tests can run in parallel. Only files that aren’t ignored by git
// are copied. The copies are removed after passing tests, but kept after
// failing tests to help with debugging.
// `clean` maps the paths of the copies back to the original fixture paths.
// To avoid compiling all dependencies from scratch (which is slow, and is
// done while holding a global lock in ~/.elm), elm-stuff/ is seeded with
// cached dependency information (see `seedElmStuff`).
// `base` is relative to tests/fixtures/, like "hot". `fixture` is relative to
// `base`, and can be nested, like "valid/postprocess". The
// whole top-level folder ("postprocess") is copied, since nested fixtures can
// refer to files further up. Returns the path to `fixture` in the copy.
export function copyFixture(base: string, fixture: string): string {
  const [first = "", ...rest] = fixture.split("/");
  return path.join(copyFixtureFolder(path.posix.join(base, first)), ...rest);
}

// `fixture` uses forward slashes, like git.
function copyFixtureFolder(fixture: string): string {
  const { currentTestName = "unknown", testPath = "unknown" } =
    expect.getState();
  const key = `${testPath}\0${currentTestName}\0${fixture}`;
  const existing = fixtureCopies.get(key);
  if (existing !== undefined) {
    return existing;
  }

  fixtureFiles ??= childProcess
    .execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "."],
      { cwd: FIXTURES_DIR, encoding: "utf8" },
    )
    .split("\0")
    .filter((file) => file !== "");

  const original = path.join(FIXTURES_DIR, fixture);
  const testDir = path.join(
    FIXTURE_COPIES_DIR,
    path.basename(testPath),
    // Tests within a file run in sequence, so a collision after shortening is
    // not a problem. The copy is recreated from scratch below.
    currentTestName.replace(/[^\w-]+/g, "-").slice(0, 50),
  );
  const copy = path.join(testDir, fixture);

  fs.rmSync(copy, { recursive: true, force: true });
  const prefix = `${fixture}/`;
  for (const file of fixtureFiles) {
    if (file.startsWith(prefix)) {
      const relative = file.slice(prefix.length);
      const target = path.join(copy, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(original, relative), target, {
        verbatimSymlinks: true,
      });
    }
  }

  for (const file of fixtureFiles) {
    if (file.startsWith(prefix) && path.basename(file) === "elm.json") {
      seedElmStuff(path.join(copy, file.slice(prefix.length)));
    }
  }

  fixtureCopies.set(key, copy);
  onTestFinished(async ({ task }) => {
    fixtureCopies.delete(key);
    if (task.result?.state === "pass") {
      await rimraf(testDir);
    }
  });
  return copy;
}

// Elm caches information about the dependencies in elm-stuff/*/{d,i,o}.dat.
// That information only depends on elm.json – both the contents and the
// modification time. So by giving all copies of elm.json the same modification
// time, the cache can be reused between all copies with the same elm.json
// contents.
function seedElmStuff(elmJsonPath: string): void {
  const content = fs.readFileSync(elmJsonPath, "utf8");
  fs.utimesSync(elmJsonPath, ELM_JSON_MTIME, ELM_JSON_MTIME);

  let sourceDirectories: Array<string>;
  try {
    const json = JSON.parse(content) as {
      type?: unknown;
      "source-directories"?: unknown;
    };
    if (
      json.type !== "application" ||
      !Array.isArray(json["source-directories"]) ||
      !json["source-directories"].every((dir) => typeof dir === "string")
    ) {
      return;
    }
    sourceDirectories = json["source-directories"];
    // Don’t let Elm try to download packages (which could be slow or hang).
    if (!allPackagesInstalled(json)) {
      return;
    }
  } catch {
    return;
  }

  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const cacheDir = path.join(ELM_STUFF_CACHE_DIR, hash);

  if (!fs.existsSync(cacheDir)) {
    warmElmStuffCache(cacheDir, content, sourceDirectories);
  }

  if (fs.existsSync(cacheDir)) {
    fs.cpSync(cacheDir, path.join(path.dirname(elmJsonPath), "elm-stuff"), {
      recursive: true,
    });
  }
}

function warmElmStuffCache(
  cacheDir: string,
  elmJsonContent: string,
  sourceDirectories: Array<string>,
): void {
  const tmp = `${cacheDir}.tmp-${process.pid}-${crypto.randomUUID()}`;
  // Nest elm.json deep enough for source directories like "../src" to stay
  // within the temporary directory.
  const depth = Math.max(
    0,
    ...sourceDirectories.map(
      (dir) => dir.split(/[\\/]/).filter((part) => part === "..").length,
    ),
  );
  const dir = path.join(tmp, ...Array.from({ length: depth }, () => "x"));
  const elmJsonPath = path.join(dir, "elm.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(elmJsonPath, elmJsonContent);
  fs.utimesSync(elmJsonPath, ELM_JSON_MTIME, ELM_JSON_MTIME);
  for (const sourceDirectory of sourceDirectories) {
    fs.mkdirSync(path.resolve(dir, sourceDirectory), { recursive: true });
  }
  const input = path.resolve(
    dir,
    sourceDirectories[0] ?? ".",
    "ElmWatchWarmup.elm",
  );
  fs.writeFileSync(
    input,
    "module ElmWatchWarmup exposing (x)\n\n\nx =\n    1\n",
  );

  const result = spawnSync("elm", ["make", input, "--output=/dev/null"], {
    cwd: dir,
    env: { ...process.env, ...TEST_ENV },
  });

  if (result.status === 0) {
    const elmStuff = path.join(dir, "elm-stuff");
    const staging = `${tmp}-cache`;
    for (const version of fs.readdirSync(elmStuff)) {
      for (const file of ["d.dat", "i.dat", "o.dat"]) {
        const source = path.join(elmStuff, version, file);
        if (fs.existsSync(source)) {
          fs.mkdirSync(path.join(staging, version), { recursive: true });
          fs.copyFileSync(source, path.join(staging, version, file));
        }
      }
    }
    try {
      // Atomic, in case another test file warms the same cache at the same time.
      fs.renameSync(staging, cacheDir);
    } catch {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

function allPackagesInstalled(json: Record<string, unknown>): boolean {
  const elmHome = process.env["ELM_HOME"] ?? path.join(os.homedir(), ".elm");
  return ["dependencies", "test-dependencies"].every((field) => {
    const dependencies = json[field] as
      | Record<string, Record<string, unknown> | undefined>
      | undefined;
    return ["direct", "indirect"].every((kind) =>
      Object.entries(dependencies?.[kind] ?? {}).every(
        ([name, version]) =>
          typeof version === "string" &&
          fs.existsSync(
            path.join(elmHome, "0.19.1", "packages", name, version),
          ),
      ),
    );
  });
}
