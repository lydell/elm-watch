import type * as http from "http";
import type * as https from "https";
import type * as stream from "stream";

type ReadStream = stream.Readable & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
};

type WriteStream = stream.Writable & {
  isTTY: boolean;
  columns?: number;
};

type CreateServer = (listeners: {
  onRequest: http.RequestListener;
  onUpgrade: (
    req: InstanceType<typeof http.IncomingMessage>,
    socket: stream.Duplex,
    head: Buffer
  ) => void;
}) =>
  | ReturnType<typeof http.createServer>
  | ReturnType<typeof https.createServer>;

declare function elmWatch(
  args: Array<string>,
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: ReadStream;
    stdout?: WriteStream;
    stderr?: WriteStream;
    createServer?: CreateServer;
  }
): Promise<number>;

export = elmWatch;
