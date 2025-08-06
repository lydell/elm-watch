/*

This regex is not perfect – see https://github.com/slevithan/emoji-regex-xs.
But I think it’s good enough.

See scripts/Emoji.ts for exactly which emojis do and do not match this regex.

*/
export const STARTS_WITH_EMOJI_REGEX = (() => {
  try {
    // eslint-disable-next-line prefer-regex-literals
    return RegExp(`^[\\p{RGI_Emoji}\\p{Extended_Pictographic}]\uFE0F? `, "v");
  } catch {
    // If the `v` flag isn’t supported (Node.js < 20), return a regex that never matches.
    return /.^/;
  }
})();
