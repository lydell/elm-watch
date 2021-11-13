function run(): void {
  // @ts-expect-error This is annoying to type :)
  window.Elm.ApplicationMain.init(); // eslint-disable-line
}

run();

export {};
