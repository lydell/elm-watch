export default function postprocess({ code }) {
  // Change from `window.Elm` to `window.NotElm.Elm`, to show that
  // elm-watch isn’t dependent on `window.Elm` existing.
  return code.replace(/\bthis\b([\W\s]+)$/, "window.NotElm$1");
}
