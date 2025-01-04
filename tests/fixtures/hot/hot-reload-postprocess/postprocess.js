export default ({ code, targetName, compilationMode }) => {
  switch (targetName) {
    case "SlowPostprocess":
      switch (compilationMode) {
        case "optimize":
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(code);
            }, 2000);
          });
        default:
          return code;
      }
    case "ESM":
      // Turn the Elm JS into an ECMAScript module.
      // We still assign `window.Elm`, though, since the tests setup expect that.
      return `const output = {}; (function(){${code}}).call(output); export default output.Elm; window.Elm = output.Elm;`;
    default:
      // Add another record field. It shouldn't affect anything.
      return "void {}.a" + Math.floor(Math.random() * 10) + ";" + code;
  }
};
