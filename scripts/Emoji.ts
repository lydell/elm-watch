/* eslint-disable no-console */

import * as https from "https";

import { GOOD_ENOUGH_STARTS_WITH_EMOJI_REGEX } from "../src/Compile";
import { bold } from "../src/Helpers";

const matching: Array<string> = [];
const nonMatching: Array<string> = [];

https
  .get(
    // Tested on this commit:
    // https://raw.githubusercontent.com/mathiasbynens/emoji-test-regex-pattern/85a0059035a7650f46294647482b95d50e84ad22/dist/latest/index-strings.txt
    "https://raw.githubusercontent.com/mathiasbynens/emoji-test-regex-pattern/main/dist/latest/index-strings.txt",
    (response) => {
      response.setEncoding("utf8");

      response.on("data", (chunk: string) => {
        for (const emoji of chunk.split("\n")) {
          if (GOOD_ENOUGH_STARTS_WITH_EMOJI_REGEX.test(`${emoji} `)) {
            matching.push(emoji);
          } else {
            nonMatching.push(emoji);
          }
        }
      });

      response.on("end", () => {
        console.log(printEmojis("MATCHING", matching));
        console.log();
        console.log();
        console.log();
        console.log(printEmojis("NOT MATCHING", nonMatching));
      });

      response.on("error", onError);
    },
  )
  .on("error", onError);

function printEmojis(title: string, emojis: Array<string>): string {
  return `
${bold(`### ${title} ###`)}

${emojis.join(" ")}
  `.trim();
}

function onError(error: Error): void {
  console.error("Request failed!", error);
}
