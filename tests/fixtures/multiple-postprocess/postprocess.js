import fs from "fs";
import path from "path";

const lock = path.join(import.meta.dirname, "lock");

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

// `main` and `second` wait for `third`. If postprocess counted towards
// `maxParallel` (2 in the tests), `main` and `second` would take up both slots
// and `third` would never start.
export default async ({ code, targetName }) => {
  switch (targetName) {
    case "main":
    case "second":
      while (fs.readFileSync(lock, "utf8") !== "third-postprocess-done") {
        await wait(100);
      }
      return code;
    case "third":
      fs.writeFileSync(lock, "third-postprocess-done");
      return code;
    default:
      throw new Error(`Unexpected target: ${targetName}`);
  }
};
