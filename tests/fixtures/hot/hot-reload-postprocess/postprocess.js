module.exports = ([code, targetName, compilationMode]) => {
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
    default:
      // Add another record field. It shouldn't affect anything.
      return "void {}.a" + Math.floor(Math.random() * 10) + ";" + code;
  }
};
