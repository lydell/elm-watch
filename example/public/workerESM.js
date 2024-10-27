import Elm from "/build/WorkerMainESM.js";

const app = Elm.WorkerMain.init();

self.addEventListener("message", (event) => {
  app.ports.fromJs.send(event.data);
});

app.ports.toJs.subscribe((numDuplicates) => {
  self.postMessage(numDuplicates);
});
