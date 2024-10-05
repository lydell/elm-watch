export default function postprocess({ code }) {
  // Make the Elm JS put `.Elm` on a local object instead of on `window`.
  // This can happen if you try to `import` a JS file created by `elm make`
  // and your bundler rewrites `this`.
  return code.replace(/\bthis\b([\W\s]+)$/, "{}$1");
};
