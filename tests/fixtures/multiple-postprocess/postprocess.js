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

export default async ({ code, targetName }) => {
  switch (targetName) {
    case "main":
      while (fs.readFileSync(lock, "utf8") !== "third-elm-done") {
        await wait(100);
      }
      fs.writeFileSync(lock, "main-postprocess-done");
      return code;
    case "second":
      while (fs.readFileSync(lock, "utf8") !== "main-postprocess-done") {
        await wait(100);
      }
      fs.writeFileSync(lock, "second-postprocess-done");
      return code;
    case "third":
      while (fs.readFileSync(lock, "utf8") !== "second-postprocess-done") {
        await wait(100);
      }
      fs.writeFileSync(lock, "third-postprocess-done");
      return code;
    default:
      throw new Error(`Unexpected target: ${targetName}`);
  }
};
