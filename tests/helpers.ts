import * as fs from "fs";
import * as os from "os";
import * as stream from "stream";

import type { ReadStream, WriteStream } from "../src";

export const IS_WINDOWS = os.platform() === "win32";

// Read file with normalized line endings to make snapshotting easier
// cross-platform.
export function readFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

export class FailReadStream extends stream.Readable implements ReadStream {
  isTTY = true;

  _read(size: number): void {
    throw new Error(
      `Expected FailReadStream not to be read but tried to read ${size} bytes.`
    );
  }

  setRawMode(): void {
    // Do nothing
  }
}

export class RawReadStream extends stream.Readable implements ReadStream {
  isRaw = false;

  isTTY = true;

  private index = 0;

  constructor(private chars: Array<string>) {
    super();
  }

  _read(size: number): void {
    if (!this.isRaw) {
      throw new Error(
        `Expected \`.setRawMode(true)\` to be called before reading, but tried to read ${size} bytes with \`.isRaw = false\`.`
      );
    }
    this.push(this.chars[this.index]);
    this.index++;
  }

  setRawMode(isRaw: boolean): void {
    this.isRaw = isRaw;
  }
}

export class MemoryWriteStream extends stream.Writable implements WriteStream {
  isTTY = true;

  content = "";

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.content += chunk.toString();
    callback();
  }
}

export function duoStream(): {
  markedStream: WriteStream;
  unmarkedStream: MemoryWriteStream;
} {
  const unmarkedStream = new MemoryWriteStream();

  class MarkedWriteStream extends stream.Writable implements WriteStream {
    isTTY = unmarkedStream.isTTY;

    _write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      unmarkedStream.write(`⟪${chunk.toString()}⟫`);
      callback();
    }
  }

  return {
    markedStream: new MarkedWriteStream(),
    unmarkedStream,
  };
}

// Make snapshots easier to read.
// Before: `"\\"string\\""`
// After: `"string"`
export const stringSnapshotSerializer = {
  test: (value: unknown): boolean => typeof value === "string",
  print: String,
};
