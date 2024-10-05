/* eslint-disable no-labels */
/* eslint-disable no-console */

import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as Codec from "tiny-decoders";

import { isNonEmptyArray } from "../src/NonEmptyArray";
import * as Parser from "../src/Parser";
import { absolutePathFromString } from "../src/PathHelpers";
import { AbsolutePath, Cwd, markAsAbsolutePath, markAsCwd } from "../src/Types";

class KnownError extends Error {}

async function run(args: Array<string>): Promise<void> {
  const [strategyRaw, ...directories] = args;

  if (strategyRaw === undefined) {
    throw new KnownError(`You must pass a strategy as the first argument.`);
  }

  if (!isNonEmptyArray(directories)) {
    throw new KnownError(
      `You must pass at least one directory to find Elm files in.`,
    );
  }

  const strategyResult = Strategy.decoder(strategyRaw);
  if (strategyResult.tag === "DecoderError") {
    throw new KnownError(Codec.format(strategyResult.error));
  }
  const strategy = strategyResult.value;

  const cwd: Cwd = markAsCwd(markAsAbsolutePath(process.cwd()));

  const elmFiles = directories.flatMap((dir) =>
    findElmFiles(absolutePathFromString(cwd, dir)),
  );

  console.log("Strategy:", strategy);
  console.log("Elm files:", elmFiles.length);
  console.time("Run");
  const imports = await runStrategy(strategy, elmFiles);
  console.timeEnd("Run");
  console.log("Imports:", imports.length);
}

type Strategy = Codec.Infer<typeof Strategy>;
const Strategy = Codec.primitiveUnion([
  "readFileSync",
  "readFile",
  "readSync",
  "read",
  "createReadStream",
  "createReadStreamForAwait",
]);

async function runStrategy(
  strategy: Strategy,
  elmFiles: Array<AbsolutePath>,
): Promise<Array<Parser.ModuleName>> {
  switch (strategy) {
    case "readFileSync":
      return elmFiles.flatMap(readFileSyncStrategy);
    case "readFile":
      return (await Promise.all(elmFiles.map(readFileStrategy))).flat();
    case "readSync":
      return elmFiles.flatMap(readSyncStrategy);
    case "read":
      return (await Promise.all(elmFiles.map(readStrategy))).flat();
    case "createReadStream":
      return (await Promise.all(elmFiles.map(createReadStreamStrategy))).flat();
    case "createReadStreamForAwait":
      return (
        await Promise.all(elmFiles.map(createReadStreamForAwaitStrategy))
      ).flat();
  }
}

function readFileSyncStrategy(elmFile: AbsolutePath): Array<Parser.ModuleName> {
  const elm = fs.readFileSync(elmFile);
  const readState = Parser.initialReadState();
  for (const char of elm) {
    Parser.readChar(char, readState);
    if (Parser.isNonImport(readState)) {
      break;
    }
  }
  return Parser.finalize(readState);
}

async function readFileStrategy(
  elmFile: AbsolutePath,
): Promise<Array<Parser.ModuleName>> {
  const elm = await fsPromises.readFile(elmFile);
  const readState = Parser.initialReadState();
  for (const char of elm) {
    Parser.readChar(char, readState);
    if (Parser.isNonImport(readState)) {
      break;
    }
  }
  return Parser.finalize(readState);
}

function readSyncStrategy(elmFile: AbsolutePath): Array<Parser.ModuleName> {
  const readState = Parser.initialReadState();
  const handle = fs.openSync(elmFile, "r");
  const buffer = Buffer.alloc(2048);
  let bytesRead = 0;
  outer: while ((bytesRead = fs.readSync(handle, buffer)) > 0) {
    for (const char of buffer.subarray(0, bytesRead)) {
      Parser.readChar(char, readState);
      if (Parser.isNonImport(readState)) {
        break outer;
      }
    }
  }
  fs.closeSync(handle);
  return Parser.finalize(readState);
}

async function readStrategy(
  elmFile: AbsolutePath,
): Promise<Array<Parser.ModuleName>> {
  const readState = Parser.initialReadState();
  const fileHandle = await fsPromises.open(elmFile, "r");
  const buffer = Buffer.alloc(2048);
  let result;
  outer: while (
    (result = await fileHandle.read(buffer, 0, buffer.byteLength)).bytesRead > 0
  ) {
    for (const char of buffer.subarray(0, result.bytesRead)) {
      Parser.readChar(char, readState);
      if (Parser.isNonImport(readState)) {
        break outer;
      }
    }
  }
  await fileHandle.close();
  return Parser.finalize(readState);
}

async function createReadStreamStrategy(
  elmFile: AbsolutePath,
): Promise<Array<Parser.ModuleName>> {
  return new Promise((resolve, reject) => {
    const readState = Parser.initialReadState();
    const stream = fs.createReadStream(elmFile, {
      highWaterMark: 2048,
    });
    stream.on("error", reject);
    stream.on("data", (chunk: Buffer) => {
      for (const char of chunk) {
        Parser.readChar(char, readState);
        if (Parser.isNonImport(readState)) {
          stream.close();
          break;
        }
      }
    });
    stream.on("close", () => {
      resolve(Parser.finalize(readState));
    });
  });
}

async function createReadStreamForAwaitStrategy(
  elmFile: AbsolutePath,
): Promise<Array<Parser.ModuleName>> {
  const readState = Parser.initialReadState();
  const stream = fs.createReadStream(elmFile, {
    highWaterMark: 2048,
  });
  outer: for await (const chunk of stream) {
    for (const char of chunk) {
      Parser.readChar(char as number, readState);
      if (Parser.isNonImport(readState)) {
        break outer;
      }
    }
  }
  return Parser.finalize(readState);
}

function findElmFiles(dir: AbsolutePath): Array<AbsolutePath> {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isFile()) {
      if (entry.name.endsWith(".elm")) {
        return [absolutePathFromString(dir, entry.name)];
      } else {
        return [];
      }
    } else if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "elm-stuff") {
        return [];
      } else {
        return findElmFiles(absolutePathFromString(dir, entry.name));
      }
    } else {
      return [];
    }
  });
}

run(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof KnownError ? error.message : error);
});
