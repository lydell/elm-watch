// Add another record field. It shouldn't affect anything.
module.exports = ([code]) =>
  "void {}.a" + Math.floor(Math.random() * 10) + ";" + code;
