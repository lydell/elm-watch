module.exports = () => {
  const error = new Error("Failed to run postprocess!");

  // Make a stable stack trace for snapshot tests.
  error.stack = `${error.name}: ${error.message}\n    at fake/stacktrace.js`;

  throw error;
};
