/* eslint-disable no-console */

import { STARTS_WITH_EMOJI_REGEX } from "../src/EmojiRegex";
import { bold } from "../src/Helpers";

const matching: Array<string> = [];
const nonMatching: Array<string> = [];

async function run(): Promise<void> {
  const response = await fetch(
    // Tested on this commit:
    // "https://raw.githubusercontent.com/mathiasbynens/emoji-test-regex-pattern/700ac302b80845324648a068738f9f809b7fce8c/dist/latest/index-strings.txt",
    "https://raw.githubusercontent.com/mathiasbynens/emoji-test-regex-pattern/main/dist/latest/index-strings.txt",
  );

  const text = await response.text();

  for (const emoji of text.split("\n")) {
    if (STARTS_WITH_EMOJI_REGEX.test(`${emoji} `)) {
      matching.push(emoji);
    } else {
      nonMatching.push(emoji);
    }
  }

  console.log(printEmojis("MATCHING", matching));
  console.log();
  console.log();
  console.log();
  console.log(printEmojis("NOT MATCHING", nonMatching));
}

function printEmojis(title: string, emojis: Array<string>): string {
  return `
${bold(`### ${title} ###`)}

${emojis.join(" ")}
  `.trim();
}

run().catch((error) => {
  console.error(error);
});
