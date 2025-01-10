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

export default async ({ code }) => {
  if (fs.existsSync(lock)) {
    fs.unlinkSync(lock);
  } else {
    fs.writeFileSync(lock, "");
    while (fs.existsSync(lock)) {
      await wait(100);
    }
  }
  return code;
};
