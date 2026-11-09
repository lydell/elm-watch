import JSConfetti from "js-confetti";
// Vite handles CSS imported from TypeScript, and hot reloads it.
import "./style.css";

const confetti = new JSConfetti();

// The compiled Elm code is loaded in a separate script tag, which creates
// `window.Elm`. See: https://lydell.github.io/elm-watch/window.Elm/
const app = window.Elm.Main.init({ node: document.getElementById("root") });

app.ports.celebrate.subscribe((count) => {
  void confetti.addConfetti({
    emojis: count % 10 === 0 ? ["🌳", "🌲"] : ["🎉", "✨", "🌈"],
  });
});
