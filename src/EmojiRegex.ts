/*

This regex is not perfect – see https://github.com/slevithan/emoji-regex-xs.
But I think it’s good enough.

See scripts/Emoji.ts for exactly which emojis do and do not match this regex.

*/
export const STARTS_WITH_EMOJI_REGEX =
  // @ts-expect-error The `v` flag needs target ES2024, but Node.js 22 supports it.
  /^[\p{RGI_Emoji}\p{Extended_Pictographic}]\uFE0F? /v;
