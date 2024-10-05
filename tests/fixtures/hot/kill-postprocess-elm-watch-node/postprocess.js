import fs from "fs";
import path from "path";

async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export default async function run({ code }) {
  const tmp = path.join(import.meta.dirname, "postprocess.tmp");
  const n = Number(fs.readFileSync(tmp, "utf8"));
  fs.writeFileSync(tmp, (n + 1).toString());

  switch (n) {
    case 1:
      return code.replace("REPLACE_ME", "postprocess content before");

    case 2:
      await wait(10000);
      return code.replace("REPLACE_ME", "postprocess should have been killed");

    default:
      return code.replace("REPLACE_ME", "postprocess content after");
  }
};
