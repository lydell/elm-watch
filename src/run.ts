import type { Logger } from "./logger";

type RunMode = "hot" | "make" | "watch";

export default async function run(
  _cwd: string,
  logger: Logger,
  runMode: RunMode
): Promise<number> {
  await Promise.resolve();
  logger.log(`Run: ${runMode}`);
  return 0;
}
