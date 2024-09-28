/*

Copied from: https://github.com/slevithan/emoji-regex-xs/blob/c107730f26757bed4faddc62f3aef336f521475f/index.mjs
Modified to only match at the beginning of strings, and followed by a space.

See scripts/Emoji.ts for exactly which emojis do and do not match this regex.

*/
/* @license

MIT License

Copyright (c) 2024 Steven Levithan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const r = String.raw;
const seq = r`(?:\p{Emoji}\uFE0F\u20E3?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation})`;
const sTags = r`\u{E0061}-\u{E007A}`;
export const STARTS_WITH_EMOJI_REGEX = new RegExp(
  r`^(?:[\u{1F1E6}-\u{1F1FF}]{2}|\u{1F3F4}[${sTags}]{2}[\u{E0030}-\u{E0039}${sTags}]{1,3}\u{E007F}|${seq}(?:\u200D${seq})*) `,
  "u"
);
