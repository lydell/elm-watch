async function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

module.exports = async ([code]) => {
  // Cause some postprocess overlap.
  await wait(500);
  return code;
};
