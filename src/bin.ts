import elmWatchCli from "./ElmWatch.ts";
import { unknownErrorToString } from "./Helpers.ts";

process.title = "elm-watch";
elmWatchCli(process.argv.slice(2))
  .then((exitCode) => {
    // Let the process exit with this exit code when the event loop is empty.
    process.exitCode = exitCode;
    if (process.stdout.isTTY) {
      process.stdout.write("Exiting elm-watch. Press ctrl+c (again) to force.");
      process.once("exit", () => {
        process.stdout.cursorTo(0);
        process.stdout.clearLine(0);
      });
    }
  })
  .catch((error: unknown) => {
    process.stderr.write(`Unexpected error:\n${unknownErrorToString(error)}\n`);
    // Forcefully exit since the watcher might still be running.
    process.exit(1);
  });
