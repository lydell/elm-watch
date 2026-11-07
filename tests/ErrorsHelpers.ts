import * as fs from "fs";
import * as path from "path";
import { expect } from "vitest";

import { __ELM_WATCH_EXIT_ON_ERROR, type Env } from "../src/Env.ts";
import * as Errors from "../src/Errors.ts";
import { toError } from "../src/Helpers.ts";
import elmWatchCli, { elmWatch } from "../src/index.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  assertExitCode,
  badElmBinEnv,
  clean,
  CursorWriteStream,
  fixtureOptions,
  logDebug,
  MemoryWriteStream,
  onlyErrorMessages,
  prependPATH,
  rimraf,
  rm,
  SilentReadStream,
  TEST_ENV,
} from "./Helpers.ts";

export function fixtureDir(fixture: string): string {
  return copyFixture("errors", fixture);
}

export async function run(
  fixture: string,
  args: Array<string>,
  options?: RunOptions,
): Promise<string> {
  return runAbsolute(fixtureDir(fixture), args, options);
}

type RunOptions = {
  env?: Env;
  isTTY?: boolean;
  exitHotOnError?: boolean;
  originalStdout?: boolean;
  // Use `elmWatch()` with these options instead of the CLI with `args`.
  elmWatchOptions?: Record<string, unknown>;
};

export async function runAbsolute(
  dir: string,
  args: Array<string>,
  {
    env,
    isTTY = true,
    exitHotOnError = false,
    originalStdout = false,
    elmWatchOptions,
  }: RunOptions = {},
): Promise<string> {
  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const sharedOptions = {
    env: {
      ...(exitHotOnError ? { [__ELM_WATCH_EXIT_ON_ERROR]: "" } : {}),
      ...(env ?? { ...process.env, ...TEST_ENV }),
    },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  };

  const exitCode =
    elmWatchOptions === undefined
      ? await elmWatchCli(args, { cwd: dir, ...sharedOptions })
      : await elmWatch({ ...elmWatchOptions, ...sharedOptions });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(1, exitCode, stdoutString, stderr.content, dir);
  expect(stderr.content).toBe("");

  return originalStdout ? stdoutString : onlyErrorMessages(stdoutString);
}

export const elmBinAlwaysSucceedEnv = {
  ...process.env,
  ...TEST_ENV,
  PATH: prependPATH(
    path.join(import.meta.dirname, "fixtures", "elm-bin-always-succeed"),
  ),
};

export async function runWithBadElmBin(
  fixture: string,
  {
    postprocess = false,
    exitHotOnError = false,
    originalStdout = false,
  }: {
    postprocess?: boolean;
    exitHotOnError?: boolean;
    originalStdout?: boolean;
  } = {},
): Promise<string> {
  const dir = fixtureDir("valid");
  const BUILD = path.join(dir, "build");
  await rimraf(BUILD);
  const postprocessDir = path.join(dir, "postprocess");
  return runAbsolute(
    postprocess ? postprocessDir : dir,
    [exitHotOnError ? "hot" : "make", "app"],
    {
      env: badElmBinEnv(path.join(dir, "bad-bin", fixture)),
      exitHotOnError,
      originalStdout,
      ...(postprocess
        ? {
            elmWatchOptions: await fixtureOptions(postprocessDir).then(
              (options) => ({
                ...options,
                runMode: exitHotOnError ? "hot" : "make",
                targets: options.targets.filter(
                  (target) => target.name === "app",
                ),
              }),
            ),
          }
        : {}),
    },
  );
}

export async function runWithBadElmBinAndWrittenError(
  fixture: string,
): Promise<{ output: string; writtenError: string }> {
  const dir = fixtureDir("valid");

  const readErrorPaths = (): Array<string> =>
    fs
      .readdirSync(dir)
      .filter((item) =>
        /^elm-watch-ElmMakeJsonParseError-[^.]+\.txt$/.test(item),
      )
      .map((item) => path.join(dir, item))
      .filter((item) => fs.statSync(item).isFile());

  for (const errorPath of readErrorPaths()) {
    rm(errorPath);
  }

  const output = await runAbsolute(dir, ["make", "app"], {
    env: badElmBinEnv(path.join(dir, "bad-bin", fixture)),
  });

  const errorPaths = readErrorPaths();

  expect(errorPaths).toHaveLength(1);
  const errorPath = errorPaths[0] ?? "impossible";

  let writtenError;
  try {
    writtenError = fs.readFileSync(errorPath, "utf8");
  } catch (unknownError) {
    const error = toError(unknownError);
    throw new Error(
      `Expected ${errorPath} to exist.\n\n${error.message}\n\n${output}`,
    );
  }

  return { output, writtenError: clean(writtenError) };
}

export function printError(errorTemplate: Errors.ErrorTemplate): string {
  return clean(Errors.toTerminalString(errorTemplate, 80, false));
}
